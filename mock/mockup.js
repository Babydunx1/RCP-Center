document.addEventListener('DOMContentLoaded', function () {
    // --- Get Elements ---
    const tabButtons = document.querySelectorAll('.epd-tab-button');
    const tabContents = document.querySelectorAll('.epd-tab-content');
    const employeeCards = document.querySelectorAll('.epd-employee-card');
    const mainHeaderName = document.getElementById('epd-employee-main-name');
    const pageGridContainer = document.querySelector('#tab-pages .epd-page-grid');
    
    let currentSelectedEmail = "tonton.002321@gmail.com"; // Set a default

    // --- ✅✅✅ Initialize Flatpickr Calendar ✅✅✅ ---
    const datePicker = flatpickr("#epd-date-picker", {
        dateFormat: "Y-m-d",
        defaultDate: "today",
        altInput: true,
        altFormat: "j F Y", // Format ที่แสดงให้ผู้ใช้เห็น เช่น "15 กรกฎาคม 2568"
        locale: "th",
        onChange: function(selectedDates, dateStr, instance) {
            // เมื่อผู้ใช้เลือกวันที่ใหม่ ให้ดึงข้อมูลของวันนั้นๆ
            fetchAndRenderDashboard(currentSelectedEmail, dateStr);
        },
    });

    // --- Tab Switching Logic ---
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            button.classList.add('active');
            const targetTabId = `tab-${button.dataset.tab}`; 
            document.getElementById(targetTabId)?.classList.add('active');
        });
    });

    // --- Employee List Selection Logic ---
    employeeCards.forEach(card => {
        card.addEventListener('click', () => {
            employeeCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            const employeeName = card.querySelector('.epd-employee-name').textContent;
            currentSelectedEmail = card.dataset.email || "tonton.002321@gmail.com"; // Update the current email

            if (mainHeaderName) {
                mainHeaderName.textContent = `ภาพรวมของ: ${employeeName}`;
            }
            
            // ดึงข้อมูลของวันนี้เป็นค่าเริ่มต้นเมื่อเลือกพนักงานใหม่
            fetchAndRenderDashboard(currentSelectedEmail, "today");
        });
    });

    /**
     * ฟังก์ชันหลักในการดึงและแสดงผลข้อมูลแดชบอร์ด
     * @param {string} email - อีเมลพนักงาน
     * @param {string} date - วันที่ที่ต้องการดูข้อมูล (เช่น "2025-07-15" หรือ "today")
     */
    function fetchAndRenderDashboard(email, date) {
        console.log(`Fetching data for ${email} on ${date}`);

        // 1. แสดงสถานะ "กำลังโหลด..."
        if (pageGridContainer) {
            pageGridContainer.innerHTML = '<p class="epd-loading-text">กำลังดึงข้อมูลเพจ...</p>';
            // สามารถเพิ่มการแสดง loading ให้กับส่วนอื่นๆ ได้เช่นกัน
        }
        
        // 2. จำลองการเรียก API (ในโปรแกรมจริงจะเรียก pywebview.api)
        simulateApiCall(email, date);
    }
    
    function simulateApiCall(email, date) {
        setTimeout(() => {
            // จำลองข้อมูลที่ได้กลับมาเปลี่ยนไปตามวันที่เลือก
            const isToday = (new Date(date).toDateString() === new Date().toDateString()) || date === 'today';
            const pageDataFromBackend = isToday 
                ? [
                    { name: 'ข่าวสดบันเทิง', platform: 'fb', status: 'complete', sent: '2/2' },
                    { name: 'ไอจีรวมมิตรดารา', platform: 'ig', status: 'pending', sent: '1/2' },
                    { name: 'เพจสายมูเตลู', platform: 'fb', status: 'missing', sent: '0/2' },
                ]
                : [ // ข้อมูลสมมติของวันอื่น
                    { name: 'ข่าวสดบันเทิง', platform: 'fb', status: 'complete', sent: '2/2' },
                    { name: 'ไอจีรวมมิตรดารา', platform: 'ig', status: 'complete', sent: '2/2' },
                ];

            renderPageCards(pageDataFromBackend);
        }, 500);
    }
    
    function renderPageCards(pages) {
        if (!pageGridContainer) return;
        pageGridContainer.innerHTML = ''; 

        if (!pages || pages.length === 0) {
            pageGridContainer.innerHTML = '<p class="epd-loading-text">ไม่พบข้อมูลเพจสำหรับพนักงานคนนี้ในวันที่เลือก</p>';
            return;
        }

        pages.forEach(page => {
            const platformIconClass = page.platform === 'fb' ? 'fab fa-facebook-square fb' : 'fab fa-instagram ig';
            const cardHTML = `
                <div class="epd-page-card">
                    <i class="${platformIconClass} platform-icon"></i>
                    <div class="epd-page-details">
                        <h4 class="epd-page-name">${page.name}</h4>
                        <a href="#" class="epd-page-link" target="_blank">คลิกเพื่อดูเพจ</a>
                    </div>
                    <div class="epd-page-status-wrapper">
                        <span class="epd-page-status ${page.status}">${page.sent}</span>
                    </div>
                </div>
            `;
            pageGridContainer.innerHTML += cardHTML;
        });
    }

    // --- เพิ่ม CSS สำหรับสถานะ Loading (ของเดิม) ---
    const style = document.createElement('style');
    style.innerHTML = `.epd-loading-text { text-align: center; color: var(--text-secondary); padding: 40px; }`;
    document.head.appendChild(style);
    
    // Initial load for the default selected employee
    fetchAndRenderDashboard(currentSelectedEmail, "today");
});