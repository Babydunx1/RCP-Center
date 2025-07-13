import gspread
import traceback
import time
import re
import calendar
from datetime import datetime


CREDS_FILE = 'credentials.json'

# Global cache
_staffs_header_cache = {}
_staffs_id_row_map_cache = {}

# ดึงข้อมูล staff จาก Google Sheet

def get_leaves_list_data(sheet_url, year, month, day, monthly_data_cache=None, staffs_data_cache=None):
    """
    ดึงข้อมูลภาพรวมของแต่ละคนสำหรับหน้า Leaves List (รายวัน)
    ใช้ข้อมูลรายเดือนและข้อมูล Staffs จาก Cache เพื่อเพิ่มความเร็ว
    """
    try:
        staffs_data = staffs_data_cache if staffs_data_cache is not None else get_staffs_data(sheet_url, sheet_name="Staffs")
        if not staffs_data:
            return []

        # ถ้าไม่มีข้อมูล cache ถูกส่งมา ให้ดึงใหม่ (เป็น fallback)
        if monthly_data_cache is None:
            print("[WARN] No monthly cache provided to get_leaves_list_data. Fetching fresh data.")
            monthly_data_cache = get_monthly_summary_data(sheet_url, year, month)

        summary_data_by_name = {record['name']: record for record in monthly_data_cache}

        _, num_days = calendar.monthrange(year, month)
        monthly_target = 40 * num_days

        leaves_list = []
        for i, staff in enumerate(staffs_data):
            name = staff.get('Name', '').strip()
            summary = summary_data_by_name.get(name, {})
            daily_data = summary.get('dailyData', {})
            
            # ใช้ day ที่ส่งมาจาก parameter ในการดึงข้อมูล
            sent_today = daily_data.get(day, {}).get('clips', 0)
            status_today_en = daily_data.get(day, {}).get('status', 'nodata')

            status_map = {
                'complete': 'ส่งครบ',
                'missing': 'ขาดส่ง',
                'holiday': 'ลา/หยุด'
            }
            status_today_th = status_map.get(status_today_en, 'ยังไม่ส่ง')

            leaves_list.append({
                "id": i + 1,
                "name": name,
                "projectName": staff.get('Project Name', '-'),
                "sentToday": sent_today,
                "statusToday": status_today_th,
                "platformFB": staff.get('FB', '0') == '1',
                "platformIG": staff.get('IG', '0') == '1',
                "monthlyTarget": monthly_target,
                "totalClipsMonth": summary.get('totalClips', 0),
                "remainingLeave": "N/A",
                "totalLeaveDays": summary.get('totalHolidays', 0),
                "totalMissingDays": summary.get('totalMissing', 0),
            })
            
        return leaves_list
    except Exception as e:
        print(f"[ERROR] get_leaves_list_data: {e}")
        traceback.print_exc()
        return []

def get_monthly_summary_data(sheet_url, year, month):
    """
    ดึงและประมวลผลข้อมูลจากชีต 'Monthly_Summary' สำหรับเดือนและปีที่ระบุ
    """
    try:
        gc = get_gspread_client()
        sheet_id = _extract_sheet_id(sheet_url)
        sh = gc.open_by_key(sheet_id)
        ws = sh.worksheet("Monthly_Summary")

        all_records = ws.get_all_records()

        # --- ภารกิจที่ 2: แก้ไข Logic การกรองวันที่ ---
        filtered_records = []
        for r in all_records:
            date_str = r.get('Date', '').strip()
            if not date_str:
                continue
            try:
                # ลองแปลงวันที่ในรูปแบบ "dd/mm/yyyy" หรือ "d/m/yy"
                dt_obj = datetime.strptime(date_str, '%d/%m/%Y')
            except ValueError:
                try:
                    dt_obj = datetime.strptime(date_str, '%d/%m/%y')
                except ValueError:
                    # ถ้าแปลงไม่ได้ ให้ข้าม record นี้ไป
                    print(f"[WARN] Could not parse date: {date_str}")
                    continue
            
            # เปรียบเทียบเดือนและปี
            if dt_obj.month == month and dt_obj.year == year:
                filtered_records.append(r)
        # --- สิ้นสุดการแก้ไข ---

        # ประมวลผลข้อมูลเป็นโครงสร้างที่ JS ต้องการ
        processed_data = {}
        for row in filtered_records:
            name = row.get('Name', '').strip()
            if not name:
                continue

            day = int(row.get('Date', '0/').split('/')[0])

            if name not in processed_data:
                processed_data[name] = {
                    "projectName": row.get('Project', ''),
                    "name": name,
                    "dailyData": {},
                    "totalClips": 0,
                    "totalMissing": 0,
                    "totalHolidays": 0,
                    "totalViews": 0 # เตรียมไว้เผื่ออนาคต
                }

            # สร้างข้อมูลรายวัน
            status_text = row.get('สถานะ', '')
            
            # --- Helper to safely convert to int ---
            def safe_int(value):
                try:
                    return int(value)
                except (ValueError, TypeError):
                    return 0
            # --- End Helper ---

            clips_sent = safe_int(row.get('TotalSent', 0))
            
            day_info = {"clips": clips_sent}
            if 'ส่งครบ' in status_text:
                day_info["status"] = "complete"
                processed_data[name]["totalClips"] += clips_sent
            elif 'ไม่ได้ส่ง' in status_text:
                day_info["status"] = "missing"
                processed_data[name]["totalMissing"] += safe_int(row.get('MissingDays', 0))
            elif 'ลา' in status_text:
                day_info["status"] = "holiday"
                day_info["text"] = "หยุด"
                processed_data[name]["totalHolidays"] += safe_int(row.get('LeaveDays', 0))
            else:
                day_info["status"] = "nodata"

            processed_data[name]["dailyData"][day] = day_info

        return list(processed_data.values())

    except Exception as e:
        print(f"[ERROR] get_monthly_summary_data: {e}")
        traceback.print_exc()
        return []


def get_staff_sheet(sheet_url):
    return fetch_google_sheet_data(sheet_url)

def fetch_google_sheet_data(sheet_url, sheet_name="Staffs", header_row=1):
    return get_staffs_data(sheet_url, sheet_name=sheet_name, header_row=header_row)

def _extract_sheet_id(url):
    match = re.search(r'/(?:spreadsheets|sheets)/d/([a-zA-Z0-9-_]+)', url)
    if match:
        return match.group(1)
    raise ValueError("Invalid Google Sheet URL: Could not extract sheet ID")

def get_users_data(sheet_url, sheet_name="Users", header_row=1):
    try:
        gc = get_gspread_client()
        sheet_id = _extract_sheet_id(sheet_url)
        sh = gc.open_by_key(sheet_id)
        ws = sh.worksheet(sheet_name)
        all_values = ws.get_all_values()
        if not all_values or len(all_values) < header_row:
            return []
        header = [h.strip() for h in all_values[header_row - 1]]
        if len(header) != len(set(header)):
            print(f"[WARN][get_users_data] Duplicate headers found: {header}")
        data_rows = all_values[header_row:]
        records = []
        for row in data_rows:
            while len(row) < len(header):
                row.append("")
            record = dict(zip(header, row))
            records.append(record)
        print(f"[DEBUG][get_users_data] header={header} records={records}")
        return records
    except Exception as e:
        print(f"[PYTHON ERROR] get_users_data: {e}")
        traceback.print_exc()
        return []

def get_staffs_data(sheet_url, sheet_name="Staffs", header_row=1):
    try:
        gc = get_gspread_client()
        sheet_id = _extract_sheet_id(sheet_url)
        sh = gc.open_by_key(sheet_id)
        ws = sh.worksheet(sheet_name)
        all_values = ws.get_all_values()
        if not all_values or len(all_values) < header_row:
            return []

        header = [h.strip() for h in all_values[header_row - 1]]
        unique_header = []
        counts = {}
        for h in header:
            if h in counts:
                counts[h] += 1
                unique_header.append(f"{h}_{counts[h]}")
            else:
                counts[h] = 1
                unique_header.append(h)

        data_rows = all_values[header_row:]
        records = []
        _staffs_id_row_map_cache.clear()
        for i, row in enumerate(data_rows):
            while len(row) < len(unique_header):
                row.append("")
            record = dict(zip(unique_header, row))
            records.append(record)
            staff_id = record.get('ID')
            if staff_id:
                _staffs_id_row_map_cache[str(staff_id)] = header_row + i + 1

        return records
    except gspread.exceptions.WorksheetNotFound:
        print(f"[PYTHON ERROR] get_staffs_data: ไม่พบชีตชื่อ '{sheet_name}' ใน URL: {sheet_url}")
        return []
    except Exception as e:
        print(f"[PYTHON ERROR] get_staffs_data: เกิดข้อผิดพลาดในการดึงข้อมูล Staffs: {e}")
        traceback.print_exc()
        return []

def update_staff_data(sheet_url, staff_id, column_name, new_value, sheet_name="Staffs", header_row=1):
    max_retries = 5
    base_delay = 1
    for attempt in range(max_retries):
        try:
            gc = get_gspread_client()
            sheet_id = _extract_sheet_id(sheet_url)
            sh = gc.open_by_key(sheet_id)
            ws = sh.worksheet(sheet_name)
            header = [h.strip() for h in ws.row_values(header_row)]
            if column_name not in header:
                return {"status": "error", "message": f"ไม่พบคอลัมน์ '{column_name}'"}
            col_index = header.index(column_name) + 1

            all_values = ws.get_all_values()
            data_rows = all_values[header_row:]
            row_index = None
            for i, row in enumerate(data_rows):
                if len(row) < len(header):
                    row += [''] * (len(header) - len(row))
                record = dict(zip(header, row))
                if str(record.get('ID', '')).strip() == str(staff_id).strip():
                    row_index = header_row + i + 1
                    break
            if row_index is None:
                return {"status": "error", "message": f"ไม่พบ Staff ID: {staff_id} ในชีต"}

            print(f"[DEBUG][update_staff_data] staff_id={staff_id}, row_index={row_index}, col={col_index}, col_name={column_name}, new_value={new_value}")
            ws.update_cell(row_index, col_index, new_value)
            return {"status": "ok", "message": f"อัปเดตข้อมูล Staff ID {staff_id} เรียบร้อย"}
        except gspread.exceptions.APIError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                print(f"[WARNING] Quota exceeded. Retrying in {delay} seconds...")
                time.sleep(delay)
            else:
                print(f"[ERROR] เกิดข้อผิดพลาดในการอัปเดตข้อมูล Staffs: {e}")
                traceback.print_exc()
                return {"status": "error", "message": str(e)}
        except Exception as e:
            print(f"[ERROR] เกิดข้อผิดพลาดในการอัปเดตข้อมูล Staffs: {e}")
            traceback.print_exc()
            return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Failed after multiple retries due to quota issues."}

def update_staff_by_email(sheet_url, user_email, column_name, new_value, sheet_name="Staffs", header_row=1):
    max_retries = 5
    base_delay = 1
    for attempt in range(max_retries):
        try:
            gc = get_gspread_client()
            sheet_id = _extract_sheet_id(sheet_url)
            sh = gc.open_by_key(sheet_id)
            ws = sh.worksheet(sheet_name)
            header = [h.strip() for h in ws.row_values(header_row)]
            
            if column_name not in header:
                return {"status": "error", "message": f"Column '{column_name}' not found in sheet."}
            col_index = header.index(column_name) + 1

            # Find the row index by matching the email
            email_col_index = header.index('E-Mail') + 1
            all_values = ws.get_all_values()
            data_rows = all_values[header_row:]
            row_index_to_update = -1
            for i, row in enumerate(data_rows):
                if len(row) > email_col_index -1 and row[email_col_index - 1].strip().lower() == user_email.strip().lower():
                    row_index_to_update = header_row + i + 1
                    break

            if row_index_to_update == -1:
                return {"status": "error", "message": f"User with email '{user_email}' not found."}

            # Update the specific cell
            ws.update_cell(row_index_to_update, col_index, new_value)
            return {"status": "ok", "message": f"Successfully updated {column_name} for {user_email}."}

        except gspread.exceptions.APIError as e:
            if e.response.status_code == 429 and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                print(f"[WARNING] Quota exceeded. Retrying in {delay} seconds...")
                time.sleep(delay)
            else:
                print(f"[ERROR] API error during staff update by email: {e}")
                return {"status": "error", "message": str(e)}
        except Exception as e:
            print(f"[ERROR] General error during staff update by email: {e}")
            return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Update failed after multiple retries due to API quota issues."}

def get_gspread_client():
    return gspread.service_account(filename=CREDS_FILE)

def get_all_tab_names(sheet_url):
    try:
        gc = get_gspread_client()
        sheet_id = _extract_sheet_id(sheet_url)
        sh = gc.open_by_key(sheet_id)
        return [ws.title for ws in sh.worksheets()]
    except Exception as e:
        print("Error in get_all_tab_names:", e)
        traceback.print_exc()
        return []

# ==== ใส่ mapping key ====
COL_RENAME = {
    'วันที่': 'Date',
    'No.': "No",
    'ชื่อเพจ/ช่อง': "PageName",
    'ลิงก์เพจ': "PageUrl",
    'FB': "FB",
    'IG': "IG",
    'ลิงก์คลิป 1': "Clip1",
    'ลิงก์คลิป 2': "Clip2",
    'ยอดวิว 1': "View1",
    'ยอดวิว 2': "View2",
    'สถานะส่งงาน': "Status",
    'เวลาส่ง 1': "SendTime1",
    'เวลาส่ง 2': "SendTime2"
}

def rename_keys(row):
    return {COL_RENAME.get(k, k): v for k, v in row.items()}

def get_employee_sheet(sheet_url, sheet_name=None, date=None):
    try:
        gc = get_gspread_client()
        sheet_id = _extract_sheet_id(sheet_url)
        sh = gc.open_by_key(sheet_id)
        
        # --- DEBUG: Log the sheet name being opened ---
        print(f"[DEBUG][get_employee_sheet] Attempting to open worksheet: '{sheet_name or 'Project Q'}'")
        
        ws = sh.worksheet(sheet_name or "Project Q")
        
        # --- DEBUG: Confirm worksheet opened successfully ---
        print(f"[DEBUG][get_employee_sheet] Successfully opened worksheet: '{ws.title}'")

        all_values = ws.get_all_values()
        if not all_values or len(all_values) < 2:
            print("[DEBUG][get_employee_sheet] No data rows found in tab")
            # ✅ Return with empty reels list but indicate success for empty data
            return {"reels": [], "sheet_name": ws.title}
        
        header = [h.strip() for h in all_values[0]]
        data_rows = all_values[1:]
        
        # --- DEBUG: Log header and first few data rows ---
        print(f"[DEBUG][get_employee_sheet] Header: {header}")
        print(f"[DEBUG][get_employee_sheet] First 3 data rows: {data_rows[:3]}")

        result = []
        for row in data_rows:
            while len(row) < len(header):
                row.append("")
            row = [cell.strip() for cell in row]
            item_th = dict(zip(header, row))
            item = rename_keys(item_th)
            
            # --- DEBUG: Log each item after renaming keys, especially the 'Date' ---
            print(f"[DEBUG][get_employee_sheet] ITEM (ENG): Date='{item.get('Date', 'N/A Date')}' | Full Item: {item}")
            
            if date:
                if item.get("Date", "") == date:
                    result.append(item)
            else:
                result.append(item)
        print(f"[DEBUG][get_employee_sheet] loaded {len(result)} rows from tab '{ws.title}'")
        return {"reels": result, "sheet_name": ws.title}
    except gspread.exceptions.WorksheetNotFound:
        print(f"[PYTHON ERROR] get_employee_sheet: ไม่พบชีตชื่อ '{sheet_name or 'Project Q'}'")
        traceback.print_exc()
        # ✅ Return error_message for specific WorksheetNotFound
        return {"reels": [], "sheet_name": sheet_name or "Project Q", "error_message": f"ไม่พบชีตชื่อ '{sheet_name or 'Project Q'}'"}
    except Exception as e:
        print("[ERROR] get_employee_sheet:", e)
        traceback.print_exc()
        # ✅ Return error_message for general exceptions
        return {"reels": [], "sheet_name": sheet_name or "Project Q", "error_message": str(e)}

# ✅ แก้ไข __all__ ให้ Export ฟังก์ชันที่จำเป็นทั้งหมด
__all__ = [
    'get_staff_sheet', 'get_users_data', 'fetch_google_sheet_data',
    'get_employee_sheet', 'update_staff_data', 'get_all_tab_names',
    'get_staffs_data', 'update_staff_by_email', 'get_monthly_summary_data', 'get_leaves_list_data'
]
