// Stats View JS - Final Connected Version



window.addEventListener('pywebviewready', function() {
    
    const statsView = document.getElementById('view-stats');
    if (!statsView) return;
    

    let allStaffs = [];
    let currentSelectedEmail = null;
    let flatpickrInstance = null;
    let hasDashboardLoadedOnce = false;
    const dashboardCache = {};

    const employeeListContainer = statsView.querySelector('.epd-employee-list');
    const mainHeaderName = statsView.querySelector('#epd-employee-main-name');
    const pageGridContainer = statsView.querySelector('#tab-pages .epd-page-grid');
    const kpiGridContainer = statsView.querySelector('#tab-overview .epd-kpi-grid');
    const datePickerInput = statsView.querySelector('#epd-date-picker');

    async function initializeView() {
        showLoadingState('พนักงาน');
        try {
            // 1. ดึงรายชื่อพนักงานและ "วันที่ล่าสุดที่มีข้อมูล" จาก Backend
            const res = await window.pywebview.api.get_all_staff_for_dashboard();
            
            if (res.status === 'ok' && res.payload.staffs && res.payload.staffs.length > 0) {
                allStaffs = res.payload.staffs;
                const latestDate = res.payload.latest_date || 'today';
                
                // 2. สร้าง Sidebar และตั้งค่าปฏิทินด้วยวันที่ที่ถูกต้อง
                renderSidebar();
                setupFlatpickr(latestDate);
                
                // 3. โหลดข้อมูลของพนักงานคนแรกด้วยวันที่ที่ถูกต้องโดยตรง
                const firstEmployee = allStaffs[0];
                if(firstEmployee) {
                    currentSelectedEmail = firstEmployee.email;
                    if (mainHeaderName) mainHeaderName.textContent = `ภาพรวมของ: ${firstEmployee.name}`;
                    
                    const firstCard = employeeListContainer.querySelector('.epd-employee-card');
                    if(firstCard) firstCard.classList.add('active');

                    await fetchAndRenderDashboard(firstEmployee.email, latestDate);
                }
            } else {
                showErrorState('ไม่สามารถโหลดข้อมูลพนักงานได้');
            }
        } catch (error) {
            console.error("Error initializing view:", error);
            showErrorState('เกิดข้อผิดพลาดในการเชื่อมต่อ Backend');
        }
    }
    /**
     * ตั้งค่าปฏิทิน
     */
    function setupFlatpickr(defaultDate) {
        if (datePickerInput) {
            flatpickrInstance = flatpickr(datePickerInput, {
                dateFormat: "Y-m-d",
                defaultDate: defaultDate, // ใช้ค่าที่ได้จาก Backend
                altInput: true,
                altFormat: "j F Y", 
                locale: "th",
                onChange: function(selectedDates, dateStr) {
                    if(currentSelectedEmail && dateStr) {
                       fetchAndRenderDashboard(currentSelectedEmail, dateStr);
                    }
                },
            });
        }
    }
    function renderSidebar() {
        if (!employeeListContainer) return;
        employeeListContainer.innerHTML = '';
        allStaffs.forEach(staff => {
            const li = document.createElement('li');
            li.className = 'epd-employee-card';
            li.dataset.email = staff.email;
            li.innerHTML = `<img src="${staff.avatar || 'https://i.pravatar.cc/40'}" alt="Avatar"><div class="epd-employee-info"><span class="epd-employee-name">${staff.name}</span><span class="epd-employee-project">${staff.project}</span></div><span class="epd-status-dot ${staff.status}"></span>`;
            employeeListContainer.appendChild(li);
        });
        bindEmployeeEvents();
    }

    function bindEmployeeEvents() {
        const employeeCards = statsView.querySelectorAll('.epd-employee-card');
        employeeCards.forEach(card => {
            card.addEventListener('click', () => {
                if (card.classList.contains('active')) return;
                employeeCards.forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                
                const employeeName = card.querySelector('.epd-employee-name').textContent;
                currentSelectedEmail = card.dataset.email;
                
                if (mainHeaderName) mainHeaderName.textContent = `ภาพรวมของ: ${employeeName}`;
                
                // ✅ เมื่อคลิก ให้ใช้ค่าวันที่จากปฏิทินเสมอ
                const dateObj = flatpickrInstance.selectedDates[0] || new Date();
                const dateStr = flatpickrInstance.formatDate(dateObj, 'Y-m-d');
                fetchAndRenderDashboard(currentSelectedEmail, dateStr);
            });
        });
    }

    /**
     * ดึงข้อมูลแดชบอร์ด (เวอร์ชันฉลาด - ใช้ Cache + API ใหม่)
     */
    async function fetchAndRenderDashboard(email, dateStr) {
        const key = `${email}_${dateStr}`;
        if (dashboardCache[key]) {
            const cachedData = dashboardCache[key];
            renderKpiCards(cachedData.kpi_cards);
            renderPageCards(cachedData.page_cards);
            return;
        }

        // ดึงข้อมูลใหม่จาก backend
        try {
            const res = await window.pywebview.api.get_employee_dashboard_data(email, dateStr);
            if (res.status === 'ok') {
                dashboardCache[key] = res.payload;  // ✨ Cache ไว้
                renderKpiCards(res.payload.kpi_cards);
                renderPageCards(res.payload.page_cards);
            } else {
                showErrorState('ไม่สามารถโหลดข้อมูลแดชบอร์ดได้: ' + res.message);
            }
        } catch (error) {
            console.error(`Error fetching dashboard data for ${email}:`, error);
            showErrorState('เกิดข้อผิดพลาดในการเชื่อมต่อ Backend');
        }
    }

    /**
     * แสดงผล KPI Cards
     */
    function renderKpiCards(kpi) {
    if (!kpiGridContainer || !kpi) {
        showErrorState('ไม่พบข้อมูล KPI');
        return;
    };

    // ✅ Logic ใหม่: ตรวจสอบข้อความในสถานะเพื่อใส่สีให้ถูกต้อง
    let statusText  = kpi.submission_status || "ยังไม่ส่ง";
    let statusClass = "";

    if (statusText.includes("ส่งครบ")) {
    statusClass = "text-green-600";   // ✅ ใช้เฉด 600
    } else if (
        statusText.includes("ขาดส่ง")
    || statusText.includes("ไม่ได้ส่ง")
    ) {
    statusClass = "text-red-600";
    } else if (statusText.includes("ยังไม่ส่ง")) {
    statusClass = "text-yellow-600";
    } else if (statusText.includes("ลา")) {
    statusClass = "text-blue-600";    // ✅ เปลี่ยนเป็นเฉด 600
    }

    // --- ส่วนแสดงผลเหมือนเดิม แต่ตอนนี้จะได้ Class สีที่ถูกต้อง ---
    kpiGridContainer.innerHTML = `
        <div class="epd-kpi-card">
            <i class="fas fa-file-invoice icon-bg"></i>
            <span class="epd-kpi-title">จำนวนเพจที่ดูแล</span>
            <span class="epd-kpi-value">${kpi.pages_managed || 0}</span>
        </div>
        <div class="epd-kpi-card">
            <i class="fas fa-check-circle icon-bg"></i>
            <span class="epd-kpi-title">สถานะส่งงานวันนี้</span>
            <span class="epd-kpi-value ${statusClass}">${statusText}</span>
        </div>
        <div class="epd-kpi-card">
            <i class="fas fa-clipboard-list icon-bg"></i>
            <span class="epd-kpi-title">ยอดรวมคลิปวันนี้</span>
            <span class="epd-kpi-value">${(kpi.total_clips_today || 0).toLocaleString()}</span>
        </div>
        <div class="epd-kpi-card">
            <i class="fas fa-calendar-check icon-bg"></i>
            <span class="epd-kpi-title">สถานะการลาวันนี้</span>
            <span class="epd-kpi-value">${kpi.leave_status}</span>
        </div>
    `;
}

     /**
     * แสดงผล Page Cards (เวอร์ชันสมบูรณ์)
     */
    function renderPageCards(pages) {
        if (!pageGridContainer) return;
        
        // ถ้าไม่มีข้อมูลเพจเลย ให้แสดงข้อความ
        if (!pages || pages.length === 0) {
            pageGridContainer.innerHTML = '<p class="epd-loading-text">ไม่พบข้อมูลเพจสำหรับพนักงานคนนี้ในวันที่เลือก</p>';
            return;
        }

        // ✅✅✅ ใช้ข้อมูลจริงจาก Backend ทั้งหมดเพื่อสร้างการ์ด ✅✅✅
        pageGridContainer.innerHTML = pages.map(page => {
            const platformIconClass = page.platform === 'fb' ? 'fab fa-facebook-square fb' : 'fab fa-instagram ig';
            const sentStatus = page.sent || "N/A"; 
            const statusClass = page.status || "pending"; // complete, pending, missing
            
            return `
                <div class="epd-page-card">
                    <i class="${platformIconClass} platform-icon"></i>
                    <div class="epd-page-details">
                        <h4 class="epd-page-name">${page.name}</h4>
                        <a href="${page.link}" class="epd-page-link" target="_blank">คลิกเพื่อดูเพจ</a>
                    </div>
                    <div class="epd-page-status-wrapper">
                        <span class="epd-page-status ${statusClass}">${sentStatus}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    function showLoadingState(item) {
        if (kpiGridContainer) kpiGridContainer.innerHTML = `<p class="epd-loading-text">กำลังโหลดข้อมูล${item}...</p>`;
        if (pageGridContainer) pageGridContainer.innerHTML = '';
    }
    function showErrorState(message) {
        if (kpiGridContainer) kpiGridContainer.innerHTML = `<p class="epd-loading-text error">${message}</p>`;
        if (pageGridContainer) pageGridContainer.innerHTML = '';
    }
    
    // --- Initial Setup ---
    // We will initialize flatpickr inside the initializeView function
    // after we get the correct latest date from the backend.

    const tabButtons = statsView.querySelectorAll('.epd-tab-button');
    const tabContents = statsView.querySelectorAll('.epd-tab-content');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            button.classList.add('active');
            statsView.querySelector(`#tab-${button.dataset.tab}`)?.classList.add('active');
        });
    });

    initializeView();
});