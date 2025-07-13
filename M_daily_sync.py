import g_sheet_api
import time
from datetime import datetime, timedelta
import traceback
import re
from google.api_core.exceptions import GoogleAPIError 

# --- สำหรับ UI ---
import tkinter as tk
from tkinter import messagebox
from tkcalendar import DateEntry # pip install tkcalendar

# --- การตั้งค่าหลัก ---
MASTER_SHEET_URL = "https://docs.google.com/spreadsheets/d/17lOtuHum9VHdukfHr7143uCGydVZSaJNi2RhzGfh81g/edit#gid=0"
STAFFS_SHEET_NAME = "Staffs"
TRANSACTION_SHEET_NAME = "Transaction"
CONFIG_SHEET_NAME = "Config"

# --- Retry settings ---
MAX_RETRIES = 5
INITIAL_RETRY_DELAY = 1 # seconds

# --- Helper function for Retry Logic ---
def retry_api_call(func, *args, **kwargs):
    """Retries a Gspread API call with exponential backoff on certain errors."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return func(*args, **kwargs)
        except GoogleAPIError as e: 
            error_message = str(e).lower()
            if "quota" in error_message or "rate limit" in error_message or "unavailable" in error_message or "timeout" in error_message or "502" in error_message or "503" in error_message:
                wait_time = INITIAL_RETRY_DELAY * (2 ** (attempt - 1))
                print(f"    ⚠️ (ครั้งที่ {attempt}/{MAX_RETRIES}) เกิดข้อผิดพลาด API (Quota/Timeout/Unavailable): {e}. กำลังรอ {wait_time} วินาทีก่อนลองใหม่...")
                time.sleep(wait_time)
            else:
                print(f"    ❌ เกิดข้อผิดพลาด API ที่ไม่สามารถลองใหม่ได้: {e}")
                raise 
        except Exception as e:
            print(f"    ❌ (ครั้งที่ {attempt}/{MAX_RETRIES}) เกิดข้อผิดพลาดที่ไม่ใช่ API เฉพาะ: {e}. กำลังลองใหม่...")
            wait_time = INITIAL_RETRY_DELAY * (2 ** (attempt - 1))
            time.sleep(wait_time) 
    raise Exception(f"ไม่สามารถดำเนินการ API call ได้หลังจาก {MAX_RETRIES} ครั้ง.")

def get_sheet_data_as_objects(sheet, header_row=1, data_range=None):
    """Helper to convert sheet data to list of objects, specifying the header row and data range."""
    try:
        if data_range:
            all_values = retry_api_call(sheet.get, data_range)
        else:
            all_values = retry_api_call(sheet.get_all_values)
    except Exception as e:
        print(f"    [Helper Error] ไม่สามารถ get values จากชีต '{sheet.title}': {e}")
        return []

    if len(all_values) < header_row:
        return []
    
    headers = [str(h).strip() for h in all_values[header_row - 1]]
    data_rows = all_values[header_row:]
    
    list_of_dicts = []
    for row in data_rows:
        while len(row) < len(headers):
            row.append('')
        list_of_dicts.append(dict(zip(headers, row)))
        
    return list_of_dicts

def col_letter_to_index(letter):
    """Converts a column letter (e.g., 'A', 'L') to a 0-based index."""
    return ord(letter.upper()) - ord('A')

# --- ฟังก์ชันช่วยในการเพิ่มแถวและจัดรูปแบบ (ใช้สำหรับคั่นวัน) ---
def append_and_format_separator(sheet, text, bg_color, text_color, num_cols_to_merge=12):
    """Appends a row with a separator text, merges cells, and formats it."""
    # We will get current_highest_row just before appending
    current_highest_row_in_sheet = len(retry_api_call(sheet.get_all_values)) 
    next_row_num = current_highest_row_in_sheet + 1

    separator_row_data = [text] + [''] * (num_cols_to_merge - 1) 

    try:
        retry_api_call(sheet.append_row, separator_row_data, value_input_option='USER_ENTERED')
        
        merge_range = f'A{next_row_num}:{chr(ord("A") + num_cols_to_merge - 1)}{next_row_num}'
        retry_api_call(sheet.merge_cells, merge_range)
        retry_api_call(sheet.format, merge_range, {
            "backgroundColor": bg_color,
            "horizontalAlignment": "CENTER",
            "textFormat": { "bold": True, "foregroundColor": text_color }
        })
        print(f"    👍 สร้างแถบคั่นที่แถว {next_row_num} เรียบร้อย!")
    except Exception as e:
        print(f"    ⚠️ ข้อผิดพลาดในการผสานหรือจัดรูปแบบเซลล์สำหรับแถบคั่น '{text}': {e}")
        print(f"    แถวที่พยายามผสาน: {merge_range}. ตรวจสอบโครงสร้างชีทหรือสิทธิ์.")
        traceback.print_exc()
    time.sleep(0.5) # พักเล็กน้อยหลังจากการเขียนและจัดรูปแบบ เพื่อให้ Sheets ประมวลผล

# --- Main Sync Logic Function (Centralized logic for both Auto and Manual) ---
def run_sync_logic(start_date, end_date, mode="auto"):
    """
    Runs the data synchronization process.
    start_date and end_date are datetime objects.
    mode indicates if it's "auto" (single day) or "manual" (date range).
    """
    client = None
    try:
        client = g_sheet_api.get_gspread_client()
        master_workbook = retry_api_call(client.open_by_url, MASTER_SHEET_URL)

        print("📥 กำลังโหลดข้อมูล Staffs และ Config...")
        staffs_sheet = retry_api_call(master_workbook.worksheet, STAFFS_SHEET_NAME)
        config_sheet = retry_api_call(master_workbook.worksheet, CONFIG_SHEET_NAME)
        transaction_sheet = retry_api_call(master_workbook.worksheet, TRANSACTION_SHEET_NAME)

        all_staffs = get_sheet_data_as_objects(staffs_sheet)
        project_configs = {conf.get('ConfigType','').strip(): conf for conf in get_sheet_data_as_objects(config_sheet) if conf.get('ConfigType')}
        print(f"✅ โหลดสำเร็จ! พบ {len(all_staffs)} พนักงาน และ {len(project_configs)} รูปแบบการตั้งค่า")

        num_cols = 12 # จำนวนคอลัมน์ทั้งหมดที่จะทำงานด้วย (A-L)
        daily_separator_bg_color = { "red": 0.95, "green": 0.95, "blue": 0.8 } # เหลืองอ่อน
        daily_separator_text_color = { "red": 0.5, "green": 0.5, "blue": 0.2 }   # เหลืองเข้ม
        person_separator_bg_color = { "red": 0.95, "green": 0.98, "blue": 0.95 } # เขียวอ่อนมาก ๆ
        blank_row_clean_color = { "red": 1, "green": 1, "blue": 1 } # สีขาวล้วน เพื่อล้างสีเดิม

        current_processing_date = start_date
        while current_processing_date <= end_date:
            date_str_for_compare = f"{current_processing_date.day}/{current_processing_date.month}/{current_processing_date.year}"
            print(f"\n--- 🎯 กำลังประมวลผลข้อมูลของวันที่: {date_str_for_compare} ---")

            # 1. เพิ่มแถบคั่น "เริ่มต้นการประมวลผลวันที่" (เขียนทันที)
            print(f"\n--- 📅 สร้างแถบคั่นเริ่มต้นสำหรับวันที่ {date_str_for_compare} ---")
            append_and_format_separator(
                transaction_sheet, 
                f"--- เริ่มต้นการประมวลผลวันที่ {current_processing_date.strftime('%d/%m/%Y')} ---",
                daily_separator_bg_color,
                daily_separator_text_color,
                num_cols
            )

            # --- START FIX: เพิ่มแถวว่างเปล่า 2 แถวหลังแถบคั่นเริ่มต้น (สำหรับ Manual Mode) ---
            if mode == "manual": 
                print("    ✨ เพิ่มแถวว่างเปล่า 2 แถวเพื่อคั่นก่อนข้อมูลจริง (สำหรับโหมดแมนนวล)...")
                for _ in range(2):
                    current_highest_row_for_blank = len(retry_api_call(transaction_sheet.get_all_values))
                    retry_api_call(transaction_sheet.append_row, [''] * num_cols, value_input_option='USER_ENTERED')
                    # จัดรูปแบบแถวที่เพิ่งเพิ่มให้เป็นสีขาวและไม่มี format อื่นๆ
                    format_range = f'A{current_highest_row_for_blank + 1}:{chr(ord("A") + num_cols - 1)}{current_highest_row_for_blank + 1}'
                    retry_api_call(transaction_sheet.format, format_range, {
                        "backgroundColor": blank_row_clean_color,
                        "textFormat": { "bold": False, "foregroundColor": { "red": 0, "green": 0, "blue": 0 } } # สีดำธรรมดา
                    })
                time.sleep(0.5) 
            # --- END FIX ---

            transactions_to_append_data = [] 
            data_rows_for_person_separator_indices = [] 

            # 2. ประมวลผลพนักงานและเตรียมข้อมูลสำหรับ Batch Append
            for i, staff in enumerate(all_staffs):
                email = staff.get("E-Mail", "").strip()
                sheet_url = staff.get("PersonalSheetURL", "").strip()
                config_type = staff.get("ConfigType", "").strip()
                project_name = staff.get("Project Name", "N/A").strip()
                
                print(f"\n--- ⚙️ ({i+1}/{len(all_staffs)}) กำลังประมวลผลของ: {email} ---")

                # --- Initialize variables before try-except ---
                mgmt_data_objects = [] 
                # --- END FIX ---

                if not all([email, sheet_url, config_type]):
                    print(f"    ⏩ ข้าม: ข้อมูลพนักงานในชีต 'Staffs' ไม่ครบถ้วน")
                    continue

                config = project_configs.get(config_type)
                if not config:
                    print(f"    ⏩ ข้าม: ไม่พบการตั้งค่าสำหรับ ConfigType '{config_type}'")
                    continue

                try:
                    staff_transactions_for_current_staff = [] 
                    
                    emp_workbook = retry_api_call(client.open_by_url, sheet_url)
                    project_sheet = retry_api_call(emp_workbook.worksheet, config['EmployeeSheetTab'])
                    mgmt_sheet = retry_api_call(emp_workbook.worksheet, config['MgmtSheetTab'])
                    timestamps_sheet = retry_api_call(emp_workbook.worksheet, 'Timestamps')

                    emp_data_as_grid = retry_api_call(project_sheet.get_all_values)
                    timestamps_data_as_grid = retry_api_call(timestamps_sheet.get_all_values)

                    mgmt_header_row = int(config.get('MgmtHeaderRow', 1))
                    mgmt_data_range = config.get('MgmtDataRange')
                    
                    # --- Assign mgmt_data_objects here inside try block ---
                    mgmt_data_objects = get_sheet_data_as_objects(mgmt_sheet, header_row=mgmt_header_row, data_range=mgmt_data_range)
                    # --- END FIX ---

                    date_col_index = ord(config.get('DateColumn').upper()) - 65
                    submission_row = None
                    timestamps_row = None
                    submission_row_index = -1

                    for idx, row in enumerate(emp_data_as_grid[1:]): 
                        if date_col_index < len(row):
                            row_date_str = str(row[date_col_index]).strip()
                            try:
                                parts = row_date_str.replace('-', '/').split('/')
                                if len(parts) == 3:
                                    d, m, y = map(int, parts)
                                    if y < 100: y += 2000
                                    # Compare with current_processing_date
                                    if f"{d}/{m}/{y}" == date_str_for_compare:
                                        submission_row = row
                                        submission_row_index = idx + 1 
                                        print(f"    👍 พบข้อมูลส่งงานของวันที่ {date_str_for_compare} ที่แถว {submission_row_index + 1}")
                                        break
                            except (ValueError, IndexError): continue
                    
                    if submission_row_index != -1 and submission_row_index < len(timestamps_data_as_grid):
                        timestamps_row = timestamps_data_as_grid[submission_row_index]
                        print(f"    👍 พบข้อมูลเวลาที่แถว {submission_row_index + 1}")

                    if not submission_row:
                        print(f"    -> ไม่พบข้อมูลส่งงานของวันที่ {date_str_for_compare}")
                        continue

                    status_header = config.get('MgmtStatusColumn')
                    name_header = config.get('MgmtTypeNameColumn')
                    url_header = config.get('MgmtUrlColumn')
                    
                    active_page_map = {}
                    for item in mgmt_data_objects:
                        is_active = 'active' in str(item.get(status_header, '')).strip().lower()
                        raw_no_value = item.get('No.')
                        if is_active and raw_no_value:
                            match = re.search(r'\d+', str(raw_no_value))
                            if match:
                                page_num = int(match.group(0))
                                active_page_map[page_num] = item
                    
                    start_col_index = ord(config.get('PageStartColumn').upper()) - 65
                    cols_per_page = int(config.get('ColumnsPerPage'))

                    for page_num in range(1, 41):
                        page_start_index = start_col_index + (page_num - 1) * cols_per_page
                        if page_start_index >= len(submission_row):
                            break 

                        link1 = submission_row[page_start_index] if page_start_index < len(submission_row) else ''
                        link2 = submission_row[page_start_index + 1] if page_start_index + 1 < len(submission_row) else ''

                        if not link1 and not link2:
                            continue
                        
                        time_sent = ''
                        time_col_index = (page_num * 2) + 1
                        
                        if timestamps_row and time_col_index < len(timestamps_row):
                            time_sent = str(timestamps_row[time_col_index]).strip()

                        page_details = active_page_map.get(page_num)
                        page_name = page_details.get(name_header, '') if page_details else ''
                        page_url = page_details.get(url_header, '') if page_details else ''
                        
                        if page_details or time_sent:
                                print(f"    ✔️ เพจ #{page_num}: พบข้อมูล! เวลา: {time_sent}")
                        else:
                                print(f"    ❌ เพจ #{page_num}: ไม่พบข้อมูลที่ Active หรือไม่มีเวลาส่ง")

                        record_id = f"{email}_{project_name}_{current_processing_date.strftime('%d%m%Y')}_Page{page_num}" 
                        
                        new_row = [
                            record_id, datetime.now().strftime('%d/%m/%Y, %H:%M:%S'), email, f"{project_name} - Page {page_num}",
                            current_processing_date.strftime('%d/%m/%Y'), link1, link2, 'Completed', sheet_url, 
                            page_url, page_name, time_sent
                        ]
                        staff_transactions_for_current_staff.append(new_row)

                    if staff_transactions_for_current_staff:
                        print(f"    ✍️ เตรียมข้อมูล {len(staff_transactions_for_current_staff)} แถวของ {email} เพื่อรวมใน Batch...")
                        transactions_to_append_data.extend(staff_transactions_for_current_staff)
                        
                        if i < len(all_staffs) - 1: 
                            transactions_to_append_data.append([''] * num_cols) 
                            data_rows_for_person_separator_indices.append(len(transactions_to_append_data) - 1) 

                    else:
                        print(f"    ℹ️ ไม่มีข้อมูลที่สามารถดึงมาได้สำหรับ {email} ในวันนี้")
                
                except Exception as e:
                    print(f"    ❌ เกิดข้อผิดพลาดกับชีตของ {email}: {e}")
                    traceback.print_exc()
            
            # 3. เขียน Batch ของข้อมูลพนักงาน (พร้อมแถวคั่นบุคคล)
            if any(row[0] != '' for row in transactions_to_append_data): 
                print(f"\n✍️ กำลังเขียนข้อมูลทั้งหมด {len(transactions_to_append_data)} แถวลงใน Transaction Sheet ใน Batch เดียวสำหรับวันที่ {date_str_for_compare}...")
                
                initial_row_count = len(retry_api_call(transaction_sheet.get_all_values)) 
                
                retry_api_call(transaction_sheet.append_rows, transactions_to_append_data, value_input_option='USER_ENTERED')
                print("    ✅ เขียนข้อมูล Batch เสร็จสิ้น!")
                
                # --- จัดรูปแบบแถวคั่นบุคคลด้วย sheet.format() ทีละแถว ---
                person_separator_bg_color = { "red": 0.95, "green": 0.98, "blue": 0.95 } 
                
                print(f"    ⚡️ กำลังจัดรูปแบบแถวคั่นบุคคลทีละแถวสำหรับวันที่ {date_str_for_compare}...")
                for relative_idx in data_rows_for_person_separator_indices:
                    current_absolute_row_num_1based = initial_row_count + relative_idx + 1 
                    format_range = f'A{current_absolute_row_num_1based}:{chr(ord("A") + num_cols - 1)}{current_absolute_row_num_1based}'
                    try:
                        retry_api_call(transaction_sheet.format, format_range, {
                            "backgroundColor": person_separator_bg_color
                        })
                    except Exception as e:
                        print(f"    ❌ ข้อผิดพลาดในการจัดรูปแบบแถวคั่นบุคคลที่แถว {current_absolute_row_num_1based}: {e}")
                        traceback.print_exc()
                print("    ✅ จัดรูปแบบแถวคั่นบุคคลเสร็จสิ้น!")
                # --- END: จัดรูปแบบแถวคั่นบุคคลด้วย sheet.format() ทีละแถว ---

            else:
                print(f"\nℹ️ ไม่มีข้อมูลจริงจากพนักงานคนใดในวันนี้ ({date_str_for_compare}) ที่จะเขียนลงชีท")

            # 4. เพิ่มแถบคั่น "สิ้นสุดการประมวลผลวันที่"
            if any(row[0] != '' for row in transactions_to_append_data): 
                print("\n✅ ประมวลผลข้อมูลรายบุคคลเสร็จสิ้น กำลังสร้างแถบคั่นประจำวัน...")
                append_and_format_separator(
                    transaction_sheet, 
                    f"--- สิ้นสุดการประมวลผลวันที่ {current_processing_date.strftime('%d/%m/%Y')} ---",
                    daily_separator_bg_color, 
                    daily_separator_text_color,
                    num_cols
                )
            else:
                print(f"\nℹ️ ไม่มีข้อมูลใหม่สำหรับวันที่ {date_str_for_compare} ในรอบนี้ จึงไม่สร้างแถบคั่นสิ้นสุดวัน")

            # --- START FIX: เพิ่มแถวว่างเปล่า 1 แถวท้ายสุดและล้างการจัดรูปแบบอย่างชัดเจน ---
            print("    ✨ เพิ่มแถวว่างเปล่าเพื่อคั่นวันถัดไปและล้างการจัดรูปแบบ...")
            # Append the blank row first
            current_highest_row_after_all_data = len(retry_api_call(transaction_sheet.get_all_values)) 
            retry_api_call(transaction_sheet.append_row, [''] * num_cols, value_input_option='USER_ENTERED')
            
            # Now, explicitly format this newly added row to be completely clean (white background, no bold, black text)
            format_range_for_clean_blank = f'A{current_highest_row_after_all_data + 1}:{chr(ord("A") + num_cols - 1)}{current_highest_row_after_all_data + 1}'
            retry_api_call(transaction_sheet.format, format_range_for_clean_blank, {
                "backgroundColor": { "red": 1, "green": 1, "blue": 1 }, # สีขาวล้วน
                "textFormat": { "bold": False, "foregroundColor": { "red": 0, "green": 0, "blue": 0 } } # สีดำธรรมดา
            })
            time.sleep(0.5) 
            # --- END FIX ---
            
            
            current_processing_date += timedelta(days=1) 

        print(f"\n--- 🎉 การซิงค์ข้อมูลทั้งหมดเสร็จสิ้น --- [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}]")
        time.sleep(1) 

    except Exception as e:
        print(f"🔥🔥🔥 เกิดข้อผิดพลาดร้ายแรงในกระบวนการซิงค์: {e}")
        traceback.print_exc()

# --- UI for Manual Sync ---
def run_manual_sync_from_ui_wrapper():
    """Wrapper function to handle UI elements and call run_sync_logic."""
    try:
        start_date_obj = cal_start.get_date()
        end_date_obj = cal_end.get_date()

        if start_date_obj > end_date_obj:
            messagebox.showerror("ข้อผิดพลาด", "วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด")
            return

        run_button.config(state=tk.DISABLED)
        root.update_idletasks() 
        
        messagebox.showinfo("เริ่มซิงค์ข้อมูล", f"กำลังซิงค์ข้อมูลจาก {start_date_obj.strftime('%Y-%m-%d')} ถึง {end_date_obj.strftime('%Y-%m-%d')}...\nโปรดดู Console/Terminal สำหรับความคืบหน้า\n(UI อาจค้างชั่วคราว)")
        
        run_sync_logic(start_date_obj, end_date_obj, mode="manual") 

        messagebox.showinfo("ซิงค์สำเร็จ", "กระบวนการซิงค์ข้อมูลเสร็จสิ้นแล้ว!")
    except Exception as e:
        messagebox.showerror("เกิดข้อผิดพลาด", f"เกิดข้อผิดพลาดในการซิงค์: {e}\nโปรดตรวจสอบ Console/Terminal")
    finally:
        run_button.config(state=tk.NORMAL)

# --- Main execution block ---
if __name__ == '__main__':
    import sys
    if '--auto' in sys.argv:
        # For auto mode, call run_sync_logic with appropriate dates for yesterday
        current_date_for_auto = datetime.now() - timedelta(days=1)
        print(f"🚀 เริ่มกระบวนการซิงค์ข้อมูลรายวันด้วย Python (โหมดอัตโนมัติ)... [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}]")
        run_sync_logic(current_date_for_auto, current_date_for_auto, mode="auto")
    else:
        # Create UI for manual sync
        root = tk.Tk()
        root.title("Manual Data Sync")

        tk.Label(root, text="วันที่เริ่มต้น:").pack(pady=5)
        cal_start = DateEntry(root, width=12, background='darkblue', foreground='white', borderwidth=2, 
                              year=datetime.now().year, month=datetime.now().month, day=1,
                              date_pattern='mm/dd/yyyy')
        cal_start.pack(pady=5)

        tk.Label(root, text="วันที่สิ้นสุด:").pack(pady=5)
        cal_end = DateEntry(root, width=12, background='darkblue', foreground='white', borderwidth=2,
                            date_pattern='mm/dd/yyyy')
        cal_end.pack(pady=5)

        run_button = tk.Button(root, text="เริ่มซิงค์ข้อมูล (Manual)", command=run_manual_sync_from_ui_wrapper)
        run_button.pack(pady=20)

        today_date = datetime.now()
        cal_start.set_date(datetime(today_date.year, today_date.month, 1))
        cal_end.set_date(datetime(today_date.year, today_date.month, min(10, today_date.day))) 

        messagebox.showinfo("โหมดการทำงาน", "โปรแกรมกำลังรอให้คุณเลือกช่วงวันที่เพื่อซิงค์ข้อมูลด้วยตนเอง\nหากต้องการรันอัตโนมัติ (ดึงข้อมูลเมื่อวาน) โปรดรันโปรแกรมด้วยคำสั่ง 'python your_sync_script.py --auto'")

        root.mainloop()