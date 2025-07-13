import gspread
from oauth2client.service_account import ServiceAccountCredentials
import pandas as pd
import traceback

def test_read_sheet():
    worksheet_name = 'Transaction'
    try:
        scope = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file'
        ]
        creds = ServiceAccountCredentials.from_json_keyfile_name('credentials.json', scope)
        client = gspread.authorize(creds)
        
        print("✅ เยี่ยม! เชื่อมต่อ Google API สำเร็จแล้ว!")
        
        # ✅ ไม่ต้องแก้ไขส่วนนี้แล้วครับ
        sheet_url = 'https://docs.google.com/spreadsheets/d/1_ac10V0UDIaZwTSgVR1x_MiU8kPZnXXYQKxFamoBXOE/edit?gid=1709030301#gid=1709030301'
        
        print(f"กำลังพยายามเปิดชีต...")
        sheet = client.open_by_url(sheet_url)
        
        print(f"กำลังพยายามเปิด Tab '{worksheet_name}'...")
        worksheet = sheet.worksheet(worksheet_name)
        
        print(f"✅ เปิด Tab '{worksheet_name}' สำเร็จ!")
        
        # ✅ --- ส่วนที่แก้ไข ---
        print("กำลังดึงข้อมูลทั้งหมดแบบไม่สนใจหัวข้อ...")
        # FIX: เปลี่ยนมาใช้ get_all_values() เพื่อเลี่ยงปัญหา Header
        list_of_lists = worksheet.get_all_values()
        
        # จากภาพชีตของลูกพี่ หัวข้อจริงๆ อยู่แถวที่ 8 (index 7) และข้อมูลเริ่มแถวที่ 9 (index 8)
        # เราจะใช้ pandas เพื่อจัดตารางให้สวยงาม
        print("กำลังจัดระเบียบข้อมูล...")
        
        # ใช้ข้อมูลในแถวที่ 8 (index 7) มาเป็น "หัวข้อคอลัมน์"
        # และนำข้อมูลตั้งแต่แถวที่ 9 (index 8) เป็นต้นไปมาเป็น "ข้อมูลในตาราง"
        df = pd.DataFrame(list_of_lists[8:], columns=list_of_lists[7])

        print("\n--- 🌟 ข้อมูลที่อ่านได้จาก Google Sheet (จัดระเบียบแล้ว) 🌟 ---")
        print(df)
        print("\n------------------------------------------------------------")
        print("\n🎉🎉🎉 สำเร็จ! ข้อมูลมาครบแล้วครับ! 🎉🎉🎉")

    except Exception as e:
        print(f"❌ เกิดข้อผิดพลาด!")
        traceback.print_exc()

        print(f"รายละเอียดข้อผิดพลาด: {e}")
       
if __name__ == '__main__':
    test_read_sheet()