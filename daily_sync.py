import g_sheet_api
import time
from datetime import datetime, timedelta, timezone # <<< ตรวจสอบว่ามี timezone import แล้ว
import traceback
import re
from google.api_core.exceptions import GoogleAPIError 

# --- การตั้งค่าหลัก ---
MASTER_SHEET_URL = "https://docs.google.com/spreadsheets/d/17lOtuHum9VHdukfHr7143uCGydVZSaJNi2RhzGfh81g/edit#gid=0"
STAFFS_SHEET_NAME = "Staffs"
TRANSACTION_SHEET_NAME = "Transaction"
CONFIG_SHEET_NAME = "Config"

# --- Retry settings ---
MAX_RETRIES = 5
INITIAL_RETRY_DELAY = 1 

# --- โค้ดแม่แบบที่สมบูรณ์ของลูกพี่ ---
def retry_api_call(func, *args, **kwargs):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return func(*args, **kwargs)
        except GoogleAPIError as e: 
            error_message = str(e).lower()
            if any(err_key in error_message for err_key in ["quota", "rate limit", "unavailable", "timeout", "502", "503"]):
                wait_time = INITIAL_RETRY_DELAY * (2 ** (attempt - 1)); print(f"    ⚠️ (ครั้งที่ {attempt}/{MAX_RETRIES}) เกิดข้อผิดพลาด API: {e}. รอ {wait_time} วิ..."); time.sleep(wait_time)
            else:
                print(f"    ❌ เกิดข้อผิดพลาด API ที่ไม่สามารถลองใหม่ได้: {e}"); raise 
        except Exception as e:
            print(f"    ❌ (ครั้งที่ {attempt}/{MAX_RETRIES}) เกิดข้อผิดพลาด: {e}. รอ {INITIAL_RETRY_DELAY * (2 ** (attempt - 1))} วิ..."); time.sleep(INITIAL_RETRY_DELAY * (2 ** (attempt - 1))) 
    raise Exception(f"ไม่สามารถดำเนินการ API call ได้หลังจาก {MAX_RETRIES} ครั้ง.")

def get_sheet_data_as_objects(sheet, header_row=1, data_range=None):
    try:
        all_values = retry_api_call(sheet.get, data_range) if data_range else retry_api_call(lambda: sheet.get_all_values())
    except Exception as e:
        print(f"    [Helper Error] ไม่สามารถ get values จากชีต '{sheet.title}': {e}"); return []
    if len(all_values) < header_row: return []
    headers = [str(h).strip() for h in all_values[header_row - 1]]
    data_rows = all_values[header_row:]
    return [dict(zip(headers, row + [''] * (len(headers) - len(row)))) for row in data_rows]

def append_and_format_separator(sheet, text, bg_color, text_color, num_cols_to_merge=12):
    current_highest_row_in_sheet = len(retry_api_call(lambda: sheet.get_all_values())) 
    next_row_num = current_highest_row_in_sheet + 1
    separator_row_data = [text] + [''] * (num_cols_to_merge - 1) 
    try:
        retry_api_call(sheet.append_row, separator_row_data, value_input_option='USER_ENTERED')
        merge_range = f'A{next_row_num}:{chr(ord("A") + num_cols_to_merge - 1)}{next_row_num}'
        retry_api_call(sheet.merge_cells, merge_range)
        retry_api_call(sheet.format, merge_range, {"backgroundColor": bg_color, "horizontalAlignment": "CENTER", "textFormat": { "bold": True, "foregroundColor": text_color }})
        print(f"    👍 สร้างแถบคั่นที่แถว {next_row_num} เรียบร้อย!")
    except Exception as e:
        print(f"    ⚠️ ข้อผิดพลาดในการสร้างแถบคั่น '{text}': {e}"); traceback.print_exc()
    time.sleep(0.5)

def get_target_date_and_mode():
    now_utc = datetime.now(timezone.utc)
    now_bkk = now_utc + timedelta(hours=7)
    if now_bkk.hour == 0:
        target_date = now_bkk - timedelta(days=1); print(f"🎯 โหมด: เก็บตกท้ายวัน (Reconciliation) | วันที่เป้าหมาย: {target_date.strftime('%d/%m/%Y')}")
    else:
        target_date = now_bkk; print(f"🎯 โหมด: อัปเดตรายชั่วโมง (Hourly) | วันที่เป้าหมาย: {target_date.strftime('%d/%m/%Y')}")
    return target_date

def delete_date_block(sheet, date_str_for_header):
    print(f"    🔍 กำลังค้นหาบล็อกข้อมูลเก่าของวันที่ {date_str_for_header} เพื่อลบ...")
    all_data = retry_api_call(sheet.get_all_values)
    start_marker = f"--- เริ่มต้นการประมวลผลวันที่ {date_str_for_header}"
    end_marker = f"--- สิ้นสุดการประมวลผลวันที่ {date_str_for_header}"
    blocks_to_delete = []
    current_start = -1
    for i, row in enumerate(all_data):
        if not row: continue
        cell_content = str(row[0])
        if start_marker in cell_content: current_start = i
        if end_marker in cell_content and current_start != -1:
            current_end = i
            if (i + 1) < len(all_data) and all(cell == '' for cell in all_data[i+1]): current_end = i + 1
            blocks_to_delete.append((current_start, current_end)); current_start = -1
    if not blocks_to_delete:
        print(f"    ℹ️ ไม่พบบล็อกข้อมูลเก่าของวันที่ {date_str_for_header} ที่ต้องลบ")
        return
    for start, end in sorted(blocks_to_delete, reverse=True):
        start_1_based, end_1_based = start + 1, end + 1
        print(f"    🗑️ พบบล็อกข้อมูลเก่าที่แถว {start_1_based} ถึง {end_1_based}. กำลังลบ...")
        try:
            body = {"requests": [{"deleteDimension": {"range": {"sheetId": sheet.id, "dimension": "ROWS", "startIndex": start, "endIndex": end + 1}}}]}
            retry_api_call(sheet.spreadsheet.batch_update, body)
            print(f"    ✅ ลบข้อมูลบล็อกเก่า {start_1_based}-{end_1_based} เรียบร้อย!")
            time.sleep(1)
        except Exception as e:
             print(f"    ❌ เกิดข้อผิดพลาดร้ายแรงขณะลบแถว: {e}")

# --- Main Sync Logic Function ---
def run_auto_sync():
    client = None
    try:
        # <<< แก้ไข: เพิ่ม timezone +7 แสดงใน Log เริ่มต้น >>>
        print(f"🚀 เริ่มกระบวนการซิงค์ข้อมูลรายวันด้วย Python... [{datetime.now(timezone.utc) + timedelta(hours=7):%Y-%m-%d %H:%M:%S}]")
        # <<< END: แก้ไข >>>

        client = g_sheet_api.get_gspread_client()
        master_workbook = retry_api_call(client.open_by_url, MASTER_SHEET_URL)
        print("📥 กำลังโหลดข้อมูล Staffs และ Config...")
        staffs_sheet, config_sheet = (retry_api_call(master_workbook.worksheet, name) for name in [STAFFS_SHEET_NAME, CONFIG_SHEET_NAME])
        all_staffs, project_configs = get_sheet_data_as_objects(staffs_sheet), {conf.get('ConfigType','').strip(): conf for conf in get_sheet_data_as_objects(config_sheet) if conf.get('ConfigType')}
        print(f"✅ โหลดสำเร็จ! พบ {len(all_staffs)} พนักงาน และ {len(project_configs)} รูปแบบการตั้งค่า")

        current_processing_date = get_target_date_and_mode()
        date_str_for_compare = f"{current_processing_date.day}/{current_processing_date.month}/{current_processing_date.year}"
        date_str_for_id = current_processing_date.strftime('%d%m%Y')
        date_str_for_header = current_processing_date.strftime('%d/%m/%Y')
        
        print(f"\n--- 🔄 เริ่มกระบวนการดึงข้อมูลสำหรับวันที่ {date_str_for_header} ---")
        transactions_to_append_data, data_rows_for_person_separator_indices, staff_data_found_for_day, num_cols = [], [], False, 12

        for i, staff in enumerate(all_staffs):
            email, sheet_url, config_type, project_name = (staff.get(k, "").strip() for k in ["E-Mail", "PersonalSheetURL", "ConfigType", "Project Name"])
            print(f"\n--- ⚙️ ({i+1}/{len(all_staffs)}) กำลังประมวลผลของ: {email} ---")
            if not all([email, sheet_url, config_type]): print(f"    ⏩ ข้าม: ข้อมูลพนักงานไม่ครบถ้วน"); continue
            config = project_configs.get(config_type)
            if not config: print(f"    ⏩ ข้าม: ไม่พบการตั้งค่าสำหรับ ConfigType '{config_type}'"); continue
            try:
                emp_workbook = retry_api_call(client.open_by_url, sheet_url)
                project_sheet, mgmt_sheet, timestamps_sheet = (retry_api_call(emp_workbook.worksheet, name) for name in [config['EmployeeSheetTab'], config['MgmtSheetTab'], 'Timestamps'])
                emp_data_as_grid, timestamps_data_as_grid = retry_api_call(project_sheet.get_all_values), retry_api_call(timestamps_sheet.get_all_values)
                mgmt_data_objects = get_sheet_data_as_objects(mgmt_sheet, int(config.get('MgmtHeaderRow', 1)), config.get('MgmtDataRange'))
                date_col_index = ord(config.get('DateColumn').upper()) - 65
                submission_row, timestamps_row, submission_row_index = None, None, -1
                for idx, row in enumerate(emp_data_as_grid[1:]): 
                    if date_col_index < len(row):
                        row_date_str = str(row[date_col_index]).strip()
                        try:
                            parts = row_date_str.replace('-', '/').split('/'); d, m, y = map(int, parts); y += 2000 if y < 100 else 0
                            if f"{d}/{m}/{y}" == date_str_for_compare:
                                submission_row, submission_row_index = row, idx + 1; print(f"    👍 พบข้อมูลส่งงานของวันที่ {date_str_for_compare} ที่แถว {submission_row_index + 1}"); break
                        except (ValueError, IndexError): continue
                if submission_row_index != -1 and submission_row_index < len(timestamps_data_as_grid):
                    timestamps_row = timestamps_data_as_grid[submission_row_index]; print(f"    👍 พบข้อมูลเวลาที่แถว {submission_row_index + 1}")
                if not submission_row:
                    print(f"    -> ไม่พบข้อมูลส่งงานของวันที่ {date_str_for_compare}"); continue
                
                status_header, name_header, url_header = config.get('MgmtStatusColumn'), config.get('MgmtTypeNameColumn'), config.get('MgmtUrlColumn')
                active_page_map = {int(re.search(r'\d+', str(item.get('No.'))).group(0)): item for item in mgmt_data_objects if 'active' in str(item.get(status_header, '')).strip().lower() and item.get('No.') and re.search(r'\d+', str(item.get('No.')))}
                start_col_index, cols_per_page = ord(config.get('PageStartColumn').upper()) - 65, int(config.get('ColumnsPerPage'))
                
                staff_transactions_for_current_staff = []
                for page_num in range(1, 41):
                    page_start_index = start_col_index + (page_num - 1) * cols_per_page
                    if page_start_index >= len(submission_row): break
                    link1, link2 = (submission_row[i] if i < len(submission_row) else '' for i in [page_start_index, page_start_index + 1])
                    if not link1 and not link2: continue
                    time_sent = str(timestamps_row[(page_num * 2) + 1]).strip() if timestamps_row and (page_num * 2) + 1 < len(timestamps_row) else ''
                    page_details = active_page_map.get(page_num)
                    page_name, page_url = (page_details.get(name_header, ''), page_details.get(url_header, '')) if page_details else ('', '')
                    if page_details or time_sent: print(f"    ✔️ เพจ #{page_num}: พบข้อมูล! เวลา: {time_sent}")
                    else: print(f"    ❌ เพจ #{page_num}: ไม่พบข้อมูลที่ Active หรือไม่มีเวลาส่ง")
                    # <<< START: แก้ไขจุดนี้ >>>
                    now_bkk_for_sync = datetime.now(timezone.utc) + timedelta(hours=7)
                    sync_timestamp_str = now_bkk_for_sync.strftime('%d/%m/%Y, %H:%M:%S')
                    record_id = f"{email}_{project_name}_{date_str_for_id}_Page{page_num}"
                    new_row = [record_id, sync_timestamp_str, email, f"{project_name} - Page {page_num}", date_str_for_header, link1, link2, 'Completed', sheet_url, page_url, page_name, time_sent]
                    # <<< END: แก้ไขจุดนี้ >>>
                    staff_transactions_for_current_staff.append(new_row)

                if staff_transactions_for_current_staff:
                    print(f"    ✍️ เตรียมข้อมูล {len(staff_transactions_for_current_staff)} แถวของ {email} เพื่อรวมใน Batch...")
                    transactions_to_append_data.extend(staff_transactions_for_current_staff)
                    staff_data_found_for_day = True 
                    if i < len(all_staffs) - 1: 
                        transactions_to_append_data.append([''] * num_cols); data_rows_for_person_separator_indices.append(len(transactions_to_append_data) - 1)
                else:
                    print(f"    ℹ️ ไม่มีข้อมูลที่สามารถดึงมาได้สำหรับ {email} ในวันนี้")
            except Exception as e: print(f"    ❌ เกิดข้อผิดพลาดกับชีตของ {email}: {e}"); traceback.print_exc()
        
        # --- ส่วนที่ 2: เขียนและจัดรูปแบบ (จัดลำดับใหม่ตามคำสั่ง) ---
        if not staff_data_found_for_day:
            print(f"\nℹ️ ไม่มีข้อมูลใหม่สำหรับวันที่ {date_str_for_header} ในรอบนี้")
        else:
            transaction_sheet = retry_api_call(master_workbook.worksheet, TRANSACTION_SHEET_NAME)

            # <<< START: จัดลำดับใหม่ตามคำสั่งของลูกพี่ >>>
            # 1. ลบบล็อกเก่าทิ้งก่อน
            delete_date_block(transaction_sheet, date_str_for_header)
            
            # 2. เขียนข้อมูลดิบและแถบคั่นบุคคลลงไปก่อน (เร็ว)
            print(f"\n✍️ กำลังเขียนข้อมูลใหม่ {len(transactions_to_append_data)} แถวลงใน Transaction Sheet...")
            initial_row_count = len(retry_api_call(lambda: transaction_sheet.get_all_values())) 
            retry_api_call(transaction_sheet.append_rows, transactions_to_append_data, value_input_option='USER_ENTERED')
            print("    ✅ เขียนข้อมูล Batch เสร็จสิ้น!")

            # 3. จัดรูปแบบแถบคั่นบุคคลที่เพิ่งเขียนไป
            person_separator_bg_color = { "red": 0.95, "green": 0.98, "blue": 0.95 }
            print(f"    ⚡️ กำลังจัดรูปแบบแถวคั่นบุคคลทีละแถว...")
            for relative_idx in data_rows_for_person_separator_indices:
                current_absolute_row_num_1based = initial_row_count + relative_idx + 1 
                format_range = f'A{current_absolute_row_num_1based}:{chr(ord("A") + num_cols - 1)}{current_absolute_row_num_1based}'
                try: retry_api_call(transaction_sheet.format, format_range, {"backgroundColor": person_separator_bg_color})
                except Exception as e: print(f"    ❌ ข้อผิดพลาดในการจัดรูปแบบแถวคั่นบุคคลที่แถว {current_absolute_row_num_1based}: {e}")
            print("    ✅ จัดรูปแบบแถวคั่นบุคคลเสร็จสิ้น!")
            
            # 4. สร้างแถบคั่นหัว-ท้าย และแถวว่าง ทีหลัง (ตาม Logic เดิม)
            daily_separator_bg_color = { "red": 0.95, "green": 0.95, "blue": 0.8 }; daily_separator_text_color = { "red": 0.5, "green": 0.5, "blue": 0.2 }
            blank_row_clean_color = { "red": 1, "green": 1, "blue": 1 }
            
            # --- START FIX: แก้ไข NameError และ DeprecationWarning ---
            # แก้ไข: ใช้ตัวแปรที่ถูกต้องคือ date_str_for_header
            print(f"\n--- 📅 กำลังสร้างแถบคั่นเริ่มต้นสำหรับวันที่ {date_str_for_header} ---")
            
            new_block_start_row = initial_row_count + 1
            retry_api_call(transaction_sheet.insert_rows, [['']]*3, row=new_block_start_row, value_input_option='USER_ENTERED')
            time.sleep(1)
            
            header_range = f'A{new_block_start_row}'
            # แก้ไข: เปลี่ยนลำดับ argument ใน .update()
            retry_api_call(transaction_sheet.update, [[f"--- เริ่มต้นการประมวลผลวันที่ {date_str_for_header} ---"]], header_range, value_input_option='USER_ENTERED')
            retry_api_call(transaction_sheet.merge_cells, f'A{new_block_start_row}:{chr(ord("A") + num_cols - 1)}{new_block_start_row}')
            retry_api_call(transaction_sheet.format, header_range, {"backgroundColor": daily_separator_bg_color, "horizontalAlignment": "CENTER", "textFormat": { "bold": True, "foregroundColor": daily_separator_text_color }})
            
            blank_range = f'A{new_block_start_row+1}:{chr(ord("A") + num_cols - 1)}{new_block_start_row+2}'
            retry_api_call(transaction_sheet.format, blank_range, {"backgroundColor": blank_row_clean_color})

            print("    ✅ สร้างแถบคั่นเริ่มต้นและแถวว่างเรียบร้อย!")
            # --- END FIX ---
            
            print("\n✅ ประมวลผลข้อมูลรายบุคคลเสร็จสิ้น กำลังสร้างแถบคั่นประจำวัน...")
            append_and_format_separator(transaction_sheet, f"--- สิ้นสุดการประมวลผลวันที่ {date_str_for_header} ---", daily_separator_bg_color, daily_separator_text_color, num_cols)
            
            print("    ✨ เพิ่มแถวว่างเปล่าเพื่อคั่นวันถัดไปและล้างการจัดรูปแบบ...")
            current_rows_after_all_data = len(retry_api_call(lambda: transaction_sheet.get_all_values())) 
            retry_api_call(transaction_sheet.append_row, [''] * num_cols, value_input_option='USER_ENTERED')
            format_range_for_clean_blank = f'A{current_rows_after_all_data + 1}:{chr(ord("A") + num_cols - 1)}{current_rows_after_all_data + 1}'
            retry_api_call(transaction_sheet.format, format_range_for_clean_blank, {"backgroundColor": blank_row_clean_color, "textFormat": { "bold": False, "foregroundColor": { "red": 0, "green": 0, "blue": 0 } } })
            time.sleep(0.5)
            # <<< END: จัดลำดับใหม่ >>>
            
    except Exception as e:
        print(f"🔥🔥🔥 เกิดข้อผิดพลาดร้ายแรงในกระบวนการซิงค์: {e}")
        traceback.print_exc()

    # <<< แก้ไข: เพิ่ม timezone +7 แสดงใน Log สุดท้าย >>>
    print(f"\n--- 🎉 การซิงค์ข้อมูลทั้งหมดเสร็จสิ้น --- [{datetime.now(timezone.utc) + timedelta(hours=7):%Y-%m-%d %H:%M:%S}]")
    time.sleep(1) 

if __name__ == '__main__':
    run_auto_sync()