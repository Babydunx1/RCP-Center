import webview
import threading
import json
import os
import calendar
import sys
import time
import traceback  # ✅✅✅ เพิ่มบรรทัดนี้เข้าไปครับ ✅✅✅
from datetime import datetime # Added this line

import g_sheet_api
from g_sheet_api import (
    get_employee_sheet,
    get_staffs_data,
    get_staff_sheet,
    get_users_data,
    fetch_google_sheet_data,
    update_staff_data,
    get_monthly_summary_data,
    get_all_tab_names,
    get_leaves_list_data
)


# ─── File-based Cache Helpers ───────────────────────────
CACHE_TTL = 60 * 60
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)


def _cache_file(name: str) -> str:
    return os.path.join(CACHE_DIR, f"{name}.json")

def _load_cache(name: str):
    path = _cache_file(name)
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < CACHE_TTL:
        print(f"[DEBUG][Cache] Loaded disk cache for '{name}'")
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None

def _save_cache(name: str, data):
    path = _cache_file(name)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"[DEBUG][Cache] Saved disk cache for '{name}'")

    # ▶ เพิ่มสองบรรทัดนี้ ต่อท้าย helper block เลย
_load_file_cache = _load_cache
_save_file_cache = _save_cache

# ──────────────────────────────────────────────────────



def canonical_id(name):
    import re
    name = name.lower().strip()
    name = re.sub(r'\s+', '_', name)
    name = re.sub(r'[^a-z0-9_]', '', name)
    return name

def get_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

class Api:

    def get_staffs_cached(self, max_age_sec=300):
        """ดึงหน้าตาราง Staffs (cache เป็นไฟล์)"""
        name = 'staffs'
        data = _load_cache(name)
        if data is not None:
            return data

        print("[Cache] fetching new 'staffs'")
        staffs = get_staffs_data(self.sheet_url, sheet_name="Staffs")
        _save_cache(name, staffs)
        return staffs

    def get_transaction_cached(self, max_age_sec=3600):
        now = time.time()

        # 1) ดูในหน่วยความจำก่อน
        if self._transaction_cache and (now - self._transaction_cache_time < max_age_sec):
            print("[DEBUG][Cache] Using RAM cache for Transaction")
            return self._transaction_cache

        # 2) ถ้า RAM หมดอายุ ลองดูในไฟล์ก่อน
        disk = _load_file_cache('transaction')
        if disk is not None:
            self._transaction_cache = disk
            self._transaction_cache_time = now
            return disk

        # 3) สุดท้าย fetch ใหม่จาก Google Sheets
        print("[DEBUG][Cache] Fetching new Transaction data from API")
        try:
            transactions = g_sheet_api.get_staffs_data(self.sheet_url, sheet_name="Transaction")
            self._transaction_cache = transactions
            self._transaction_cache_time = now
            _save_file_cache('transaction', transactions)
            return transactions
        except Exception as e:
            print(f"[ERROR][Python API] Failed to load transaction data: {e}")
            self._transaction_cache = None
            return []

    def get_employee_sheet_cached(self, sheet_name, max_age_sec=3600):
        """ดึงซ้ำ Project แต่ละ Tab จากไฟล์ cache ก่อน ถ้าไม่มีค่อย fetch ใหม่"""
        key = sheet_name.lower().replace(" ", "_")
        data = _load_cache(f"sheet_{key}")
        if data is not None:
            return data

        print(f"[Cache] fetching new sheet '{sheet_name}'")
        lst = get_employee_sheet(self.sheet_url, sheet_name=sheet_name).get('reels', [])
        _save_cache(f"sheet_{key}", lst)
        return lst

    def get_monthly_summary_cached(self, year, month, max_age_sec=3600):
        key = f"summary_{year}_{month}"
        now = time.time()
        if key in self._monthly_summary_cache and (now - self._monthly_summary_cache_time[key] < max_age_sec):
            return self._monthly_summary_cache[key]

        disk = _load_file_cache(key)
        if disk is not None:
            self._monthly_summary_cache[key] = disk
            self._monthly_summary_cache_time[key] = now
            return disk

        print(f"[DEBUG][Cache] Fetching new Monthly Summary for {month}/{year}")
        try:
            data = get_monthly_summary_data(self.sheet_url, year, month)
            self._monthly_summary_cache[key] = data
            self._monthly_summary_cache_time[key] = now
            _save_file_cache(key, data)
            return data
        except Exception as e:
            print(f"[ERROR][Python API] Failed to load monthly summary: {e}")
            return []


    def clear_caches(self):
        self._transaction_cache      = None
        self._transaction_cache_time = 0
        self._staffs_cache           = None
        self._staffs_cache_time      = 0
        self._monthly_summary_cache.clear()
        self._monthly_summary_cache_time.clear()

        # ลบไฟล์ cache ทั้งหมดในโฟลเดอร์ cache/
        for fn in os.listdir(CACHE_DIR):
            if fn.endswith('.json'):
                os.remove(os.path.join(CACHE_DIR, fn))

        print("[DEBUG][Cache] All caches cleared")
        return {"status": "ok"}

    # ✅✅✅ เพิ่มฟังก์ชันนี้เข้าไปในคลาส Api ✅✅✅
    def get_transaction_cached(self, max_age_sec=3600):
        """
        ดึงข้อมูลจากชีต Transaction โดยใช้ระบบ Cache เพื่อความเร็ว
        """
        import time
        now = time.time()
        # ถ้ามี Cache อยู่และยังไม่หมดอายุ (5 นาที) ให้ใช้ Cache
        if self._transaction_cache and (now - self._transaction_cache_time < max_age_sec):
            print("[DEBUG][Cache] Using cached Transaction data.")
            return self._transaction_cache
        
        # ถ้าไม่มี Cache หรือหมดอายุแล้ว ให้ไปดึงใหม่
        print("[DEBUG][Cache] Fetching new Transaction data.")
        try:
            transactions = g_sheet_api.get_staffs_data(self.sheet_url, sheet_name="Transaction")
            self._transaction_cache = transactions
            self._transaction_cache_time = now
            return transactions
        except Exception as e:
            print(f"[ERROR][Python API] Failed to load transaction data (cache): {e}")
            self._transaction_cache = None # เคลียร์ cache ถ้าดึงข้อมูลใหม่ไม่สำเร็จ
            return []


    # วางฟังก์ชันนี้ต่อจากฟังก์ชันอื่นในคลาส Api ได้เลยครับ
    def get_all_staff_for_dashboard(self):
        try:
            staffs_raw_data = g_sheet_api.get_staffs_data(self.sheet_url, sheet_name="Staffs")

            # --- ส่วนที่เพิ่มเข้ามา: หาวันที่ล่าสุด ---
            latest_data_date = None
            try:
                transaction_data = g_sheet_api.get_staffs_data(self.sheet_url, sheet_name="Transaction")
                dates_in_sheet = []
                for row in transaction_data:
                    date_str = row.get('SubmissionDate')
                    if not date_str or not date_str.strip():
                        continue
                    
                    try:
                        # มีความยืดหยุ่นต่อ space และรูปแบบ dd/mm/yyyy หรือ d/m/yyyy
                        day, month, year = map(int, date_str.strip().split('/'))
                        if year < 100:
                            year += 2000
                        dates_in_sheet.append(datetime(year, month, day))
                    except (ValueError, TypeError) as ve:
                        print(f"[WARN] Could not parse date '{date_str}'. Error: {ve}. Skipping.")
                        continue

                if dates_in_sheet:
                    latest_data_date = max(dates_in_sheet).strftime('%Y-%m-%d')
            except Exception as e:
                print(f"[WARN] Could not determine latest date: {e}")
                traceback.print_exc()
            # --- สิ้นสุดส่วนที่เพิ่ม ---

            employee_list = [{
                "name": staff.get("Name", "-"),
                "email": staff.get("E-Mail", ""),
                "project": staff.get("Project Name", "-"),
                "status": "online" if staff.get("Status", "").lower() == 'active' else 'offline',
                "avatar": staff.get("AvatarUrl", "https://i.pravatar.cc/40")
            } for staff in staffs_raw_data]
            
            return {"status": "ok", "payload": {"staffs": employee_list, "latest_date": latest_data_date}}

        except Exception as e:
            print(f"[ERROR][Python API] get_all_staff_for_dashboard: {e}")
            return {"status": "error", "message": str(e)}


    # วางฟังก์ชันนี้ต่อจากฟังก์ชันอื่นในคลาส Api

    def get_employee_page_details(self, email, date_str):
        """
        API สำหรับดึงข้อมูล "เฉพาะ" ส่วนของการ์ดเพจ (Page Cards)
        สำหรับหน้า Stats & Analytics
        """
        print(f"[API] Fetching PAGE DETAILS for {email} on {date_str}")
        try:
            selected_date = datetime.strptime(date_str, "%Y-%m-%d")
            sheet_date_format = selected_date.strftime('%#d/%#m/%Y')
            
            # 1. ดึงข้อมูลพื้นฐานของพนักงาน
            staffs_data = self.get_staffs_cached()
            staff_info = next((s for s in staffs_data if s.get("E-Mail") == email), {})
            if not staff_info:
                return {"status": "error", "message": "ไม่พบข้อมูลพนักงาน"}

            project_sheet_name = staff_info.get("Project Name")
            daily_target = int(staff_info.get("DailyTarget", 2))

            # 2. ดึงข้อมูล Transaction ของวันนั้นๆ
            transaction_data = g_sheet_api.get_staffs_data(self.sheet_url, sheet_name="Transaction")
            employee_transactions = [row for row in transaction_data if row.get('EmployeeEmail') == email and row.get('SubmissionDate') == sheet_date_format]

            # 3. ดึงข้อมูลจากชีต Project ของพนักงาน
            project_sheet_data = []
            if project_sheet_name:
                project_sheet_data = g_sheet_api.get_employee_sheet(self.sheet_url, sheet_name=project_sheet_name).get('reels', [])
            daily_project_data = [row for row in project_sheet_data if row.get('Date') == sheet_date_format]

            # 4. รวบรวมข้อมูล Page Cards (รองรับกรณีไม่มีชื่อเพจ)
            unique_pages = {}
            for row in employee_transactions:
                # ใช้ลิงก์เป็น key เพื่อ dedupe และให้แสดงแม้ไม่มีชื่อเพจ
                link = row.get('LinkPage', '').strip()
                if not link or link in unique_pages:
                    continue

                page_name = row.get('NamePage', '').strip()  # อาจเป็น "" ก็ได้
                platform  = 'ig' if 'instagram.com' in link.lower() else 'fb'

                # หาแถวของเพจใน daily_project_data (เช็ค PageName)
                proj_row = next(
                    (p for p in daily_project_data
                    if p.get('PageName', '').strip().lower() == page_name.lower()),
                    None
                )
                try:
                    clips_sent = int(proj_row.get('Clips_Sent', 0))
                except (ValueError, AttributeError):
                    clips_sent = 0

                # กำหนดสถานะการส่ง
                if clips_sent >= daily_target:
                    sent_status = 'complete'
                elif clips_sent > 0:
                    sent_status = 'pending'
                else:
                    sent_status = 'missing'

                unique_pages[link] = {
                    "name":     page_name,         # จะแสดงช่องชื่อเปล่าได้
                    "link":     link,
                    "platform": platform,
                    "status":   sent_status,
                    "sent":     f"{clips_sent}/{daily_target}"
                }

            return {"status": "ok", "payload": list(unique_pages.values())}

        except Exception as e:
            print(f"[ERROR][Python API] get_employee_page_details: {e}")
            traceback.print_exc()
            return {"status": "error", "message": str(e)}

    def get_employee_dashboard_data(self, email, date_str):
        """
        API สำหรับดึงข้อมูลทั้งหมดสำหรับหน้า Stats Dashboard (เวอร์ชันแก้ไข Error และใช้ Project Name ในการ map)
        """
        print(f"[API] Fetching final dashboard data for {email} on {date_str}")
        try:
            # === STEP 1: PREPARATION (ส่วนนี้ถูกต้องแล้ว) ===
            selected_date = datetime.strptime(date_str, "%Y-%m-%d")
            possible_date_formats = {
                selected_date.strftime('%d/%m/%Y'),
                f"{selected_date.day}/{selected_date.month}/{selected_date.year}"
            }
            
            # === STEP 2: FETCH DATA (ส่วนนี้ถูกต้องแล้ว) ===
            staffs_data = self.get_staffs_cached()
            transaction_data = self.get_transaction_cached()
            monthly_summary_data = self.get_monthly_summary_cached(selected_date.year, selected_date.month)

            staff_info = next((s for s in staffs_data if s.get("E-Mail", "").strip().lower() == email.strip().lower()), None)
            if not staff_info:
                return {"status": "error", "message": f"ไม่พบข้อมูลพนักงานสำหรับ {email}"}

            employee_transactions = [
                row for row in transaction_data 
                if row.get('EmployeeEmail', '').strip().lower() == email.strip().lower() 
                and row.get('SubmissionDate', '').strip() in possible_date_formats
            ]

            # === STEP 3: BUILD PAGE CARDS (รองรับกรณีไม่มีชื่อเพจ) ===
            # กำหนดค่า daily_target_per_page จากข้อมูล staff_info
            # ← อย่าลืมกำหนด daily_target_per_page ก่อนใช้
            daily_target_per_page = int(staff_info.get("DailyTarget", 2))
            page_cards_list = []
            seen_links = set()
            # daily_target_per_page มาจากด้านบน
            for row in employee_transactions:
                link = row.get('LinkPage', '').strip()
                # ถ้าไม่มีลิงก์ หรือเคยประมวลผลแล้ว ข้ามไป
                if not link or link in seen_links:
                    continue
                seen_links.add(link)

                # ชื่อเพจอาจว่างได้
                page_name = row.get('NamePage', '').strip()

                # แยกแพลตฟอร์ม
                platform = 'ig' if 'instagram.com' in link.lower() else 'fb'

                # คำนวณจำนวนคลิปที่ส่ง
                clips_sent = 0
                clips_val = row.get('Clips_Sent', '').strip()
                if clips_val.isdigit():
                    clips_sent = int(clips_val)
                else:
                    # ถ้าไม่มีคอลัมน์ Clips_Sent ก็ลองนับจาก Link1/Link2
                    if row.get('Link1', '').strip():
                        clips_sent += 1
                    if row.get('Link2', '').strip():
                        clips_sent += 1

                # กำหนดสถานะ
                if clips_sent >= daily_target_per_page:
                    status_class = 'complete'
                elif clips_sent > 0:
                    status_class = 'pending'
                else:
                    status_class = 'missing'

                # เก็บผล
                page_cards_list.append({
                    'name':     page_name,                   # อาจเป็น "" ก็ยังแสดงกล่อง
                    'link':     link,
                    'platform': platform,
                    'status':   status_class,
                    'sent':     f'{clips_sent}/{daily_target_per_page}'
                })

            # === STEP 4: CALCULATE KPIs (แก้ไขให้ถูกต้องตาม Logic ของลูกพี่) ===
            pages_managed_kpi = len(page_cards_list)
            
            
            
            # ✅ 1. แก้ไข NameError โดยกำหนดค่าเริ่มต้นให้ตัวแปรที่อาจไม่ถูกสร้าง
            total_clips_today = 0
            submission_status_kpi = "ยังไม่ส่ง" # ตั้งค่าเริ่มต้น
            leave_status_kpi = "ปกติ"      # ตั้งค่าเริ่มต้น

            try:
                # ✅ ใช้ "Project Name" จาก staff_info ในการค้นหา
                staff_project_name = staff_info.get('Project Name', '').strip()
                summary_for_staff = next((s for s in monthly_summary_data if s.get('projectName', '').strip().lower() == staff_project_name.lower()), None)

                if summary_for_staff:
                    daily_dict = summary_for_staff.get('dailyData', {})
                    # int-key (18) จะ match กับ processed_data, ถ้าไม่เจอ ค่อยลอง str
                    day_data = daily_dict.get(selected_date.day) or daily_dict.get(str(selected_date.day))
                    if day_data:
                        # ✅✅✅ ดึงค่าจากชีตมาแสดงตรงๆ ตามที่ลูกพี่ต้องการสำหรับหน้า Stats ✅✅✅
                        total_clips_today = day_data.get('clips', 0)
                        
                        # Logic เดิมใน g_sheet_api แปลง 'สถานะ' เป็น 'status' (เช่น 'complete', 'missing')
                        # เราจะแปลงมันกลับเป็นภาษาไทยที่สวยงามสำหรับ UI
                        status_from_api = day_data.get('status', 'nodata')

                        if status_from_api == 'complete':
                            submission_status_kpi = "ส่งครบ"
                        elif status_from_api == 'missing':
                            submission_status_kpi = "ขาดส่ง"
                        elif status_from_api == 'holiday':
                            submission_status_kpi = "ลา"
                        else: # 'nodata'
                            submission_status_kpi = "ยังไม่ส่ง"
                        
                        # แยกเช็คสถานะการลา
                        if status_from_api == 'holiday':
                            leave_status_kpi = "ลา"

                    else:
                        # ถ้าไม่เจอข้อมูลของ "วัน" นั้นๆ ใน summary
                        submission_status_kpi = "ยังไม่ส่ง"
                else:
                     # ถ้าไม่เจอข้อมูลของ "โปรเจกต์" นั้นๆ ใน summary
                     submission_status_kpi = "ไม่มีข้อมูลสรุป"

            except Exception as e_summary:
                print(f"[ERROR] เกิดข้อผิดพลาดขณะประมวลผล KPI ของหน้า Stats: {e_summary}")
                submission_status_kpi = "Error"
                leave_status_kpi = "Error"

            kpi_data = { 
                "pages_managed": pages_managed_kpi,
                "submission_status": submission_status_kpi,
                "total_clips_today": total_clips_today, 
                "leave_status": leave_status_kpi 
            }

            # === STEP 5: ASSEMBLE FINAL PAYLOAD ===
            dashboard_payload = {
                "kpi_cards": kpi_data,
                "page_cards": page_cards_list
            }
            return {"status": "ok", "payload": dashboard_payload}

        except Exception as e:
            print(f"[ERROR][Python API] get_employee_dashboard_data: {e}")
            traceback.print_exc()
            return {"status": "error", "message": str(e)}
        

    def __init__(self, sheet_url):
        self.sheet_url = sheet_url
        self.current_user = None
        self.window = None
        self._staffs_cache = None
        self._staffs_cache_time = 0
        self._monthly_summary_cache = {} # Cache for monthly data { (year, month): data }
        self._monthly_summary_cache_time = {} # Timestamp for each cache entry
        self._transaction_cache = None
        self._transaction_cache_time = 0
        self._employee_sheet_cache      = {}
        self._employee_sheet_cache_time = {}

    def get_monthly_summary_cached(self, year, month, max_age_sec=3600):
        import time
        now = time.time()
        cache_key = (year, month)

        if cache_key in self._monthly_summary_cache and (now - self._monthly_summary_cache_time.get(cache_key, 0) < max_age_sec):
            print(f"[DEBUG][Cache] Using cached summary for {month}/{year}")
            return self._monthly_summary_cache[cache_key]
        
        print(f"[DEBUG][Cache] Fetching new summary for {month}/{year}")
        try:
            summary_data = get_monthly_summary_data(self.sheet_url, year, month)
            self._monthly_summary_cache[cache_key] = summary_data
            self._monthly_summary_cache_time[cache_key] = now
            return summary_data
        except Exception as e:
            print(f"[ERROR][Python API] Failed to load monthly summary (cache): {e}")
            return []

    def fetch_leaves_list(self, year=None, month=None, day=None):
        """ API สำหรับดึงข้อมูลตารางในหน้า Leaves (รายวัน) """
        print(f"[DEBUG][Python API] fetch_leaves_list called with year={year}, month={month}, day={day}")
        try:
            now = datetime.now()
            target_year = year if year is not None else now.year
            target_month = month if month is not None else now.month
            target_day = day if day is not None else now.day

            # Use the new caching mechanism for monthly data
            monthly_data = self.get_monthly_summary_cached(target_year, target_month)
            
            # Use cached staffs data
            staffs_data = self.get_staffs_cached()
            
            # Pass monthly_data and staffs_data directly to avoid re-fetching
            data = get_leaves_list_data(self.sheet_url, target_year, target_month, target_day, monthly_data, staffs_data)
            return {"status": "ok", "payload": data}
        except Exception as e:
            print(f"[ERROR][Python API] fetch_leaves_list failed: {e}")
            return {"status": "error", "message": str(e)}    
        

    def fetch_monthly_summary(self, year, month):
        """ API สำหรับให้ JS เรียกเพื่อดึงข้อมูลสรุปรายเดือน """
        print(f"[DEBUG][Python API] fetch_monthly_summary called for {month}/{year}")
        try:
            # ใช้ cached data
            data = self.get_monthly_summary_cached(year, month)
            
            # --- คำนวณ 'เป้าต่อเดือน' ที่นายต้องการ ---
            _, num_days = calendar.monthrange(year, month)
            monthly_target = 40 * num_days

            # เพิ่ม 'เป้าต่อเดือน' เข้าไปในข้อมูลของแต่ละคน
            for person_data in data:
                person_data['monthlyTarget'] = monthly_target
            
            return {"status": "ok", "payload": data}
        except Exception as e:
            print(f"[ERROR][Python API] fetch_monthly_summary failed: {e}")
            return {"status": "error", "message": str(e)}   



    def get_staffs_cached(self, max_age_sec=3600):
        now = time.time()
        if self._staffs_cache and (now - self._staffs_cache_time < max_age_sec):
            return self._staffs_cache

        disk = _load_file_cache('staffs')
        if disk is not None:
            self._staffs_cache = disk
            self._staffs_cache_time = now
            return disk

        print("[DEBUG][Cache] Fetching new Staffs data from API")
        try:
            staffs = get_staffs_data(self.sheet_url, sheet_name="Staffs")
            self._staffs_cache = staffs
            self._staffs_cache_time = now
            _save_file_cache('staffs', staffs)
            return staffs
        except Exception as e:
            print(f"[ERROR][Python API] Failed to load staffs data: {e}")
            return []

    def login(self, email, remember=False):
        print(f"[DEBUG][Python API] Login request for email: {email}")

        # 1. ดึงข้อมูลพนักงาน (cached)
        staffs = self.get_staffs_cached()
        print(f"[DEBUG][Python API] Fetched staffs data: {len(staffs)} records (cached)")

        # 2. หา user record
        match = next(
            (s for s in staffs
            if s.get("E-Mail", "").strip().lower() == email.strip().lower()),
            None
        )
        if not match:
            print(f"[DEBUG][Python API] User not found for email: {email}")
            return {"status": "error", "message": "ไม่พบผู้ใช้งาน"}

        # 3. อ่าน role และ project info
        role               = match.get("Role", "User")
        project_name_raw   = match.get("Project Name", "").strip()
        project_id         = canonical_id(project_name_raw)
        print(f"[DEBUG][Python API] User '{email}' found. Role: '{role}', Project Name: '{project_name_raw}', Project ID: '{project_id}'")

        # 4. กำหนด AllowedProjects & ProjectMap
        if role.lower() == 'admin':
            all_tabs      = get_all_tab_names(self.sheet_url)
            exclude_tabs  = {
                "Staffs", "Leaves", "Salary", "Stats",
                "Notifications", "Export Data", "Settings", "Admin Dashboard"
            }
            allowed       = []
            project_map   = {}
            # สร้าง map ของเจ้าของโปรเจกต์
            owner_map = {}
            for s in staffs:
                p = s.get("Project Name", "").strip()
                e = s.get("E-Mail", "").strip()
                if p and e:
                    pid = canonical_id(p)
                    owner_map.setdefault(pid, e)

            for tab in all_tabs:
                if tab not in exclude_tabs:
                    pid = canonical_id(tab)
                    allowed.append(pid)
                    project_map[pid] = {"tab": tab, "owner": owner_map.get(pid)}

            print(f"[DEBUG][Python API] Admin mode. Allowed projects: {allowed}")
            print(f"[DEBUG][Python API] Project Map: {project_map}")
        else:
            allowed     = [project_id] if project_id else []
            project_map = {
                project_id: {"tab": project_name_raw, "owner": email}
            } if project_id else {}
            print(f"[DEBUG][Python API] User mode. Allowed projects: {allowed}")

        # 5. เซ็ต current_user
        self.current_user = {
            "E-Mail":         email,
            "Role":           role,
            "AllowedProjects": allowed,
            "ProjectMap":     project_map
        }
        print(f"[DEBUG][Python API] Current user set: {self.current_user}")

        # 6. บันทึก token ถ้ามี remember
        if remember:
            token_data = {"email": email, "role": role}
            token_path = os.path.join(os.path.dirname(__file__), 'user_token.json')
            with open(token_path, 'w', encoding='utf-8') as f:
                json.dump(token_data, f)
            print(f"[DEBUG][Python API] Remember Me: Token saved to {token_path}")

        # 7. Pre-warm caches & project sheets ใน background
        def _prewarm():
            print("[DEBUG][Python API] Pre-warming caches...")
            try:
                # พื้นฐาน
                self.get_transaction_cached()
                self.get_staffs_cached()
                now = datetime.now()
                self.get_monthly_summary_cached(now.year, now.month)

                # ถ้าเป็น admin ให้โหลด sheet ของทุกโปรเจกต์
                if role.lower() == 'admin':
                    for pid, info in project_map.items():
                        tab = info.get("tab")
                        if not tab:
                            continue
                        try:
                            print(f"[DEBUG][Python API] Pre-warming sheet '{tab}'")
                            self.get_employee_sheet_cached(tab)
                            print(f"[DEBUG][Python API] Pre-warmed sheet '{tab}' successfully")
                        except Exception as e:
                            # ไม่ให้ thread crash, แค่ log error
                            print(f"[ERROR][Cache Prewarm] Failed to prewarm '{tab}': {e}")

                # ตบท้ายด้วยดึง Leaves ไว้ดูทันที
                print("[DEBUG][Python API] Pre-warming Leaves data")
                self.fetch_leaves_list()
            except Exception as e:
                print(f"[ERROR][Cache Prewarm] Unexpected error in prewarm: {e}")
            finally:
                print("[DEBUG][Python API] Pre-warm complete.")

        threading.Thread(target=_prewarm, daemon=True).start()

        return {
            "status":  "ok",
            "payload": self.current_user
        }

    def logout(self):
        self.current_user = None
        # Remove token file if exists
        token_path = os.path.join(os.path.dirname(__file__), 'user_token.json')
        if os.path.exists(token_path):
            os.remove(token_path)
            print(f"[DEBUG][Python API] Token file removed: {token_path}")
        print("[DEBUG][Python API] User logged out.")
        return {"status": "ok"}

    def auto_login(self):
        token_path = os.path.join(os.path.dirname(__file__), 'user_token.json')
        print(f"[DEBUG][Python API] auto_login: Looking for token at {token_path}")
        if os.path.exists(token_path):
            try:
                with open(token_path, 'r', encoding='utf-8') as f:
                    token_data = json.load(f)
                email = token_data.get('email')
                print(f"[DEBUG][Python API] auto_login: Read token email={email}")
                if email:
                    login_result = self.login(email, remember=True)
                    print(f"[DEBUG][Python API] auto_login: login_result={login_result}")
                    return login_result
            except Exception as e:
                print(f"[ERROR][Python API] Failed to auto-login: {e}")
        else:
            print(f"[DEBUG][Python API] auto_login: Token file not found")
        return {"status": "error", "message": "No valid token found"}

    def fetch_employee_data(self, project_id):
        print(f"[DEBUG][Python API] fetch_employee_data called for project_id: {project_id}")
        if not self.current_user:
            print("[ERROR][Python API] fetch_employee_data: Not logged in.")
            return {"status": "error", "message": "Not logged in"}

        allowed = self.current_user.get("AllowedProjects", [])
        project_map = self.current_user.get("ProjectMap", {})

        print(f"[DEBUG][Python API] current_user.Role: {self.current_user['Role'].lower()}")
        print(f"[DEBUG][Python API] project_id in allowed: {project_id in allowed}")

        # The project_id passed from JS is already canonical (e.g., 'project_q')
        # We need to get the original sheet name from project_map
        sheet_info = project_map.get(project_id)
        sheet_name = None
        # Support both old (str) and new (dict) structure for sheet_info
        if isinstance(sheet_info, dict):
            sheet_name = sheet_info.get("tab")
        elif isinstance(sheet_info, str):
            sheet_name = sheet_info

        if self.current_user["Role"].lower() != "admin" and project_id not in allowed:
            print(f"[ERROR][Python API] fetch_employee_data: Permission denied for project_id '{project_id}'")
            return {"status": "error", "message": "Permission denied"}

        # Try to be robust: if not found, try to match by canonical name (case-insensitive)
        if not sheet_name:
            # Try to find by canonical name in project_map values
            for v in project_map.values():
                if isinstance(v, dict) and canonical_id(v.get("tab", "")) == project_id:
                    sheet_name = v.get("tab")
                    break
                elif isinstance(v, str) and canonical_id(v) == project_id:
                    sheet_name = v
                    break

        if not sheet_name:
            print(f"[ERROR][Python API] fetch_employee_data: Sheet name not found for project_id '{project_id}' in map: {project_map}")
            return {"status": "error", "message": f"ไม่พบชื่อชีตสำหรับโปรเจกต์ '{project_id}'"}

        print(f"[DEBUG][Python API] fetch_employee_data: Fetching data for sheet_name: '{sheet_name}' (from project_id '{project_id}')")
        try:
            data = get_employee_sheet(self.sheet_url, sheet_name)
            if "error_message" in data:
                print(f"[ERROR][Python API] get_employee_sheet returned error: {data['error_message']}")
                return {"status": "error", "message": data["error_message"]}
            print(f"[DEBUG][Python API] fetch_employee_data: Successfully fetched data from sheet '{sheet_name}'. Reels count: {len(data.get('reels', []))}")
            return {"status": "ok", "payload": data}
        except Exception as e:
            print(f"[ERROR][Python API] fetch_employee_data: Error calling get_employee_sheet: {e}")
            return {"status": "error", "message": str(e)}

    def fetch_staffs_data(self, sheet_url):
        print(f"[DEBUG][Python API] fetch_staffs_data called for sheet_url: {sheet_url}")
        try:
            # เปลี่ยนให้ใช้ get_staffs_cached แทน get_staffs_data
            data = self.get_staffs_cached(max_age_sec=300)
            print(f"[DEBUG][Python API] Returning {len(data)} cached staffs")
            return {"status": "ok", "payload": data}
        except Exception as e:
            print(f"[ERROR][Python API] fetch_staffs_data: Error: {e}")
            return {"status": "error", "payload": [], "message": str(e)}

    def update_staff_info(self, sheet_url, staff_id, column_name, new_value):
        print(f"[DEBUG][Python API] update_staff_info called for staff_id: {staff_id}, column: {column_name}, value: {new_value}")
        try:
            # ✅ ส่ง column_name ตรงๆ ไปให้ update_staff_data
            result = update_staff_data(self.sheet_url, staff_id, column_name, new_value)
            print(f"[DEBUG][Python API] update_staff_info result: {result}")
            return result
        except Exception as e:
            print(f"[ERROR][Python API] update_staff_info: Error: {e}")
            return {"status": "error", "message": str(e)}

    def fetch_all_tab_names(self):
        print("[DEBUG][Python API] fetch_all_tab_names called.")
        try:
            names = get_all_tab_names(self.sheet_url)
            print(f"[DEBUG][Python API] Fetched tab names: {names}")
            return {"status": "ok", "payload": names}
        except Exception as e:
            print(f"[ERROR][Python API] fetch_all_tab_names: Error: {e}")
            return {"status": "error", "message": str(e)}

    def python_callback_to_js(self, response_data):
        if self.window:
            js = f"handle_python_callback({json.dumps(response_data, ensure_ascii=False)})"
            self.window.evaluate_js(js)

    def get_profile_data(self):
        print(f"[DEBUG][Python API] get_profile_data called for user: {self.current_user.get('E-Mail')}")
        if not self.current_user or 'E-Mail' not in self.current_user:
            return {"status": "error", "message": "Current user not found or not logged in."}

        # The user data is already in self.current_user from login
        # To get the most up-to-date info, we re-fetch from the sheet
        try:
            staffs = get_staffs_data(self.sheet_url, sheet_name="Staffs")
            user_email = self.current_user['E-Mail'].strip().lower()
            
            user_data = next((s for s in staffs if s.get("E-Mail", "").strip().lower() == user_email), None)

            if not user_data:
                return {"status": "error", "message": f"User {user_email} not found in Staffs sheet."}

            profile = {
                "name": user_data.get("Name", ""),
                "email": user_data.get("E-Mail", ""),
                "role": user_data.get("Role", ""),
                "avatar_url": user_data.get("AvatarUrl", "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&auto=format&fit=crop") # Default avatar
            }
            print(f"[DEBUG][Python API] Found profile data: {profile}")
            return {"status": "ok", "payload": profile}

        except Exception as e:
            print(f"[ERROR][Python API] Failed to get profile data: {e}")
            return {"status": "error", "message": str(e)}

    def update_profile_name(self, new_name):
        print(f"[DEBUG][Python API] update_profile_name called for user: {self.current_user.get('E-Mail')} with new_name: {new_name}")
        if not self.current_user or 'E-Mail' not in self.current_user:
            return {"status": "error", "message": "Current user not found or not logged in."}
        
        if not new_name or not isinstance(new_name, str) or new_name.strip() == "":
            return {"status": "error", "message": "Invalid name provided."}

        user_email = self.current_user['E-Mail']

        try:
            # CORRECTED: Call the function that updates by email
            result = g_sheet_api.update_staff_by_email(self.sheet_url, user_email=user_email, column_name="Name", new_value=new_name.strip())
            
            if result.get("status") == "ok":
                print(f"[DEBUG][Python API] Successfully updated name for {user_email}")
            else:
                print(f"[ERROR][Python API] Failed to update name for {user_email}: {result.get('message')}")

            return result
        except Exception as e:
            print(f"[ERROR][Python API] Exception during name update: {e}")
            return {"status": "error", "message": str(e)}

    def update_profile_avatar(self, new_avatar_url):
        print(f"[DEBUG][Python API] update_profile_avatar called for user: {self.current_user.get('E-Mail')} with new_avatar_url: {new_avatar_url}")
        if not self.current_user or 'E-Mail' not in self.current_user:
            return {"status": "error", "message": "Current user not found or not logged in."}
        
        if not new_avatar_url or not isinstance(new_avatar_url, str) or new_avatar_url.strip() == "":
            return {"status": "error", "message": "Invalid avatar URL provided."}

        user_email = self.current_user['E-Mail']

        try:
            result = g_sheet_api.update_staff_by_email(self.sheet_url, user_email=user_email, column_name="AvatarUrl", new_value=new_avatar_url.strip())
            
            if result.get("status") == "ok":
                print(f"[DEBUG][Python API] Successfully updated avatar for {user_email}")
            else:
                print(f"[ERROR][Python API] Failed to update avatar for {user_email}: {result.get('message')}")

            return result
        except Exception as e:
            print(f"[ERROR][Python API] Exception during avatar update: {e}")
            return {"status": "error", "message": str(e)}

    def list_profile_pics(self):
        print("[DEBUG][Python API] list_profile_pics called.")
        profile_pics_dir = get_path("img/profile_pics/")
        if not os.path.exists(profile_pics_dir):
            print(f"[ERROR][Python API] Profile pictures directory not found: {profile_pics_dir}")
            return {"status": "error", "message": "Profile pictures directory not found."}

        image_files = []
        for filename in os.listdir(profile_pics_dir):
            if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp')):
                image_files.append(f"img/profile_pics/{filename}")
        
        print(f"[DEBUG][Python API] Found {len(image_files)} profile pictures.")
        return {"status": "ok", "payload": image_files}


if __name__ == '__main__':
    SHEET_URL = 'https://docs.google.com/spreadsheets/d/17lOtuHum9VHdukfHr7143uCGydVZSaJNi2RhzGfh81g/edit#gid=1356715801'
    api = Api(SHEET_URL)
    window = webview.create_window(
        'RCP Center',
        'rcp_dashboard.html',
        js_api=api,
        width=1730,            # ✅ ขนาดเริ่มต้น (เท่ากันเลยถ้าอยากนิ่ง)
        height=950,            # ความสูงเริ่มต้น (ปรับได้)
        min_size=(1350, 400)   # ✅ ล็อกความกว้างขั้นต่ำเท่านั้น, ความสูงต่ำสุดตั้งไว้พอไม่พัง
    )
    api.window = window
    webview.start(debug=True)
