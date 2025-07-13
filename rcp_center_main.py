import webview
import threading
import json
import os
import calendar
import sys
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
    def __init__(self, sheet_url):
        self.sheet_url = sheet_url
        self.current_user = None
        self.window = None
        self._staffs_cache = None
        self._staffs_cache_time = 0
        self._monthly_summary_cache = {} # Cache for monthly data { (year, month): data }
        self._monthly_summary_cache_time = {} # Timestamp for each cache entry

    def get_monthly_summary_cached(self, year, month, max_age_sec=600):
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



    def get_staffs_cached(self, max_age_sec=300):
        import time
        now = time.time()
        if self._staffs_cache and (now - self._staffs_cache_time < max_age_sec):
            return self._staffs_cache
        try:
            staffs = get_staffs_data(self.sheet_url, sheet_name="Staffs")
            self._staffs_cache = staffs
            self._staffs_cache_time = now
            return staffs
        except Exception as e:
            print(f"[ERROR][Python API] Failed to load staffs data (cache): {e}")
            return []

    def login(self, email, remember=False):
        print(f"[DEBUG][Python API] Login request for email: {email}")
        staffs = self.get_staffs_cached()
        print(f"[DEBUG][Python API] Fetched staffs data: {len(staffs)} records (cached)")

        match = next((s for s in staffs if s.get("E-Mail", "").strip().lower() == email.strip().lower()), None)
        if not match:
            print(f"[DEBUG][Python API] User not found for email: {email}")
            return {"status": "error", "message": "ไม่พบผู้ใช้งาน"}

        role = match.get("Role", "User")
        project_name_raw = match.get("Project Name", "").strip()
        project_id = canonical_id(project_name_raw)

        print(f"[DEBUG][Python API] User '{email}' found. Role: '{role}', Project Name (raw): '{project_name_raw}', Project ID: '{project_id}'")

        if role.lower() == 'admin':
            all_tabs = get_all_tab_names(self.sheet_url)
            exclude_tabs = {"Staffs", "Leaves", "Salary", "Stats", "Notifications", "Export Data", "Settings", "Admin Dashboard"}
            allowed = []
            project_map = {}
            staffs_data = staffs  # use cached
            project_owner_map = {}
            for staff in staffs_data:
                staff_project = staff.get("Project Name", "").strip()
                staff_email = staff.get("E-Mail", "").strip()
                if staff_project and staff_email:
                    pid = canonical_id(staff_project)
                    if pid not in project_owner_map:
                        project_owner_map[pid] = staff_email
            for tab in all_tabs:
                if tab not in exclude_tabs:
                    pid = canonical_id(tab)
                    allowed.append(pid)
                    owner_email = project_owner_map.get(pid, None)
                    project_map[pid] = {"tab": tab, "owner": owner_email}
            print(f"[DEBUG][Python API] Admin mode. All tabs: {all_tabs}, Allowed projects (canonical): {allowed}, Project Map: {project_map}")
        else:
            allowed = [project_id] if project_id else []
            project_map = {project_id: {"tab": project_name_raw, "owner": email}} if project_id else {}
            print(f"[DEBUG][Python API] User mode. Allowed projects (canonical): {allowed}, Project Map: {project_map}")

        self.current_user = {
            "E-Mail": email,
            "Role": role,
            "AllowedProjects": allowed,
            "ProjectMap": project_map
        }
        print(f"[DEBUG][Python API] Current user set: {self.current_user}")

        if remember:
            token_data = {"email": email, "role": role}
            token_path = os.path.join(os.path.dirname(__file__), 'user_token.json')
            with open(token_path, 'w', encoding='utf-8') as f:
                json.dump(token_data, f)
            print(f"[DEBUG][Python API] Remember Me: Token saved to {token_path}")
        
        # Pre-load Leaves data for admin users in a background thread
        if role.lower() == 'admin':
            print("[DEBUG][Python API] Admin user logged in. Starting background pre-load of Leaves data...")
            # Start pre-loading in a separate thread to avoid blocking the UI
            threading.Thread(target=self.fetch_leaves_list).start()
            print("[DEBUG][Python API] Background pre-load thread for Leaves data started.")

        return {
            "status": "ok",
            "payload": self.current_user
        }

        # Pre-load Leaves data for admin users in a background thread
        if role.lower() == 'admin':
            print("[DEBUG][Python API] Admin user logged in. Starting background pre-load of Leaves data...")
            # Start pre-loading in a separate thread to avoid blocking the UI
            threading.Thread(target=self.fetch_leaves_list).start()
            print("[DEBUG][Python API] Background pre-load thread for Leaves data started.")

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
