// This file combines code from monthly_all_summary_script.js and summary_detail_script.js



// ==== SECTION: Monthly Summary (ภาพรวมทั้งเดือน) ====
function initMonthlySummaryView() {
    console.log('initMonthlySummaryView running');

    const allSummaryTbody       = document.getElementById('all-summary-tbody');
    const monthlySummaryTitle  = document.getElementById('monthly-summary-title');
    // Removed Flatpickr related elements from here

    // 1) กำหนดวันที่เริ่มต้นเป็นวันนี้ แล้วอัพเดต title
    const today     = new Date();
    const defYear   = today.getFullYear();
    const defMonth  = today.getMonth() + 1; // 1–12
    monthlySummaryTitle.textContent =
      `ภาพรวมการส่งคลิปประจำเดือน: ${monthly_getMonthName(defMonth)} ${defYear}`;

    // Removed Flatpickr initialization and button listener from here

    // 4) เรียก fetch ข้อมูลครั้งแรก (เดือนปัจจุบัน)
    monthly_fetchAndDisplayAllSummaryData(defYear, defMonth);

    const selectMonth = document.getElementById('select-month');
    const selectYear = document.getElementById('select-year');
    const viewSummaryDataBtn = document.getElementById('view-summary-data-btn');

    if (selectMonth && selectYear && viewSummaryDataBtn) {
        const updateSummaryData = () => {
            const year = parseInt(selectYear.value);
            const month = parseInt(selectMonth.value);
            monthly_fetchAndDisplayAllSummaryData(year, month);
        };

        viewSummaryDataBtn.addEventListener('click', updateSummaryData);
        // Optionally, you could also add 'change' listeners to selectMonth and selectYear
        // selectMonth.addEventListener('change', updateSummaryData);
        // selectYear.addEventListener('change', updateSummaryData);
    }
}





async function monthly_fetchAndDisplayAllSummaryData(year, month) {
    const allSummaryTbody = document.getElementById('all-summary-tbody');
    if (allSummaryTbody) allSummaryTbody.innerHTML = '<tr><td colspan="33" style="text-align:center; padding: 20px;">กำลังดึงข้อมูล...</td></tr>';

    try {
        const res = await window.pywebview.api.fetch_monthly_summary(year, month);

        if (res.status === 'ok' && res.payload && res.payload.length > 0) {
            window.monthlySummaryCache = res.payload;
            monthly_renderMonthlyAllSummaryTable(res.payload);
        } else {
            if (allSummaryTbody) allSummaryTbody.innerHTML = '<tr><td colspan="33" style="text-align:center; padding: 20px;">ไม่พบข้อมูลสำหรับเดือนนี้</td></tr>';
            if (res.message) console.error("Error fetching summary:", res.message);
        }
    } catch (error) {
        console.error("Failed to fetch monthly summary:", error);
        if (allSummaryTbody) allSummaryTbody.innerHTML = '<tr><td colspan="33" style="text-align:center; padding: 20px;">เกิดข้อผิดพลาดในการเชื่อมต่อ</td></tr>';
    }
}

function monthly_renderMonthlyAllSummaryTable(allUsersData) {
    const allSummaryTbody = document.getElementById('all-summary-tbody');
    let tableRowsHtml = '';
    const daysInMonth = 31; // แสดง 31 วันเสมอ

    allUsersData.forEach(user => {
        // เพิ่ม data-username เพื่อให้รู้ว่าแถวนี้เป็นของใคร
        tableRowsHtml += `
            <tr data-username="${user.name}" style="cursor: pointer;" title="คลิกเพื่อดูรายละเอียดของ ${user.name}">
                <td class="sticky-col-data">${user.projectName}</td>
                <td class="sticky-col-data">${user.name}</td>
                ${monthly_generateDailyCells(user.dailyData, daysInMonth)}
            </tr>`;
    });

    if (allSummaryTbody) {
        allSummaryTbody.innerHTML = tableRowsHtml;
        // เพิ่ม Event Listener ให้แต่ละแถว เพื่อให้คลิกแล้วไปหน้ารายละเอียด
        allSummaryTbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', () => {
                const userName = row.dataset.username;
                if (userName) {
                    // เรียกใช้ฟังก์ชันที่อยู่ใน rcp_app.js เพื่อสลับ view และส่งข้อมูล
                    if (window.switchView && typeof window.switchView === 'function') {
                        window.switchView('summary-detail');
                        initDetailSummaryView(userName);
                    }
                }
            });
        });
    }

    monthly_applyStickyColumns('.monthly-all-summary-table');
    monthly_addTooltipListeners();
}

function monthly_generateDailyCells(dailyData, daysInMonth) {
    let cellsHtml = '';
    for (let i = 1; i <= daysInMonth; i++) {
        const dayInfo = dailyData[i] || { status: 'nodata', text: '' };
        let content = '';
        let statusClass = `status-daily-${dayInfo.status}`;

        if (dayInfo.status === 'complete') {
            content = dayInfo.clips !== undefined ? dayInfo.clips : '';
        } else if (dayInfo.status === 'missing' || dayInfo.status === 'holiday') {
            content = dayInfo.text || (dayInfo.status === 'missing' ? 'ขาด' : 'หยุด');
        }

        cellsHtml += `
            <td class="${statusClass} daily-cell-info"
                data-day="${i}"
                data-status="${dayInfo.status}"
                data-clips="${dayInfo.clips || ''}"
                data-text="${dayInfo.text || ''}">
                ${content}
            </td>`;
    }
    return cellsHtml;
}

function monthly_applyStickyColumns(tableSelector) {
    const table = document.querySelector(tableSelector);
    if (!table) return;

    const firstColHeaders = table.querySelectorAll('th.sticky-col-header:first-child');
    const firstColDataCells = table.querySelectorAll('td.sticky-col-data:first-child');
    const secondColHeaders = table.querySelectorAll('th.sticky-col-header:nth-child(2)');
    const secondColDataCells = table.querySelectorAll('td.sticky-col-data:nth-child(2)');

    firstColHeaders.forEach(cell => { cell.style.position = 'sticky'; cell.style.left = '0'; });
    firstColDataCells.forEach(cell => { cell.style.position = 'sticky'; cell.style.left = '0'; });

    const firstColWidth = firstColHeaders.length > 0 ? firstColHeaders[0].offsetWidth : 150;

    secondColHeaders.forEach(cell => { cell.style.position = 'sticky'; cell.style.left = `${firstColWidth}px`; });
    secondColDataCells.forEach(cell => { cell.style.position = 'sticky'; cell.style.left = `${firstColWidth}px`; });
}

function monthly_getMonthName(monthNumber) {
    const date = new Date();
    date.setMonth(monthNumber - 1);
    return date.toLocaleString('th-TH', { month: 'long' });
}

let monthly_currentTooltip = null;
function monthly_addTooltipListeners() {
    const cells = document.querySelectorAll('.daily-cell-info');
    cells.forEach(cell => {
        cell.addEventListener('mouseenter', monthly_showTooltip);
        cell.addEventListener('mouseleave', monthly_hideTooltip);
    });
}

function monthly_showTooltip(event) {
    const cell = event.currentTarget;
    if (monthly_currentTooltip) {
        document.body.removeChild(monthly_currentTooltip);
    }
    const tooltip = document.createElement('div');
    tooltip.className = 'daily-cell-tooltip-dynamic';
    const day = cell.dataset.day;
    const status = cell.dataset.status
    let content = `สถานะ: ${status}<br>วันที่: ${day}`;
    if(cell.dataset.clips) content += `<br>คลิป: ${cell.dataset.clips}`;
    tooltip.innerHTML = content;
    document.body.appendChild(tooltip);
    const rect = cell.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX + rect.width / 2 - tooltip.offsetWidth / 2}px`;
    tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight - 5}px`;
    monthly_currentTooltip = tooltip;
}

function monthly_hideTooltip() {
    if (monthly_currentTooltip) {
        if (monthly_currentTooltip.parentNode) {
            monthly_currentTooltip.parentNode.removeChild(monthly_currentTooltip);
        }
        monthly_currentTooltip = null;
    }
}


// ==== SECTION: Summary Detail (ภาพรวมรายคน) ====
function initDetailSummaryView(userNameFromApp = null) {
    let userName = userNameFromApp;
    if (!userName) {
        const urlParams = new URLSearchParams(window.location.search);
        userName = urlParams.get('name');
    }

    const pageTitle = document.getElementById('page-title');
    const summaryHeader = document.getElementById('summary-title');
    const userNameDisplay = document.getElementById('user-name-display');

    if (userName) {
        if (pageTitle) pageTitle.textContent = `ภาพรวมของ ${userName}`;
        if (summaryHeader) summaryHeader.textContent = `ภาพรวมการส่งคลิปประจำเดือนของ ${userName}`;
        if (userNameDisplay) userNameDisplay.textContent = userName;
        detail_fetchAndDisplaySummaryData(userName);
    } else {
        if (pageTitle) pageTitle.textContent = 'ไม่พบผู้ใช้';
        // ... (โค้ดจัดการกรณีไม่พบ userName เหมือนเดิม) ...
    }
}

async function detail_fetchAndDisplaySummaryData(userName) {
    const totalClips = document.getElementById('total-clips');
    const totalMissing = document.getElementById('total-missing');
    const totalHolidays = document.getElementById('total-holidays');
    const totalViews = document.getElementById('total-views');
    const calendarTbody = document.getElementById('calendar-tbody');

    let dataFromCache = window.monthlySummaryCache || [];
    let data = dataFromCache.find(p => p.name === userName);

    // --- START: แก้ไข Action Button Bug ---
    // ถ้าไม่พบข้อมูลใน cache ให้ไปดึงข้อมูลของเดือนปัจจุบันมาใหม่
    if (!data) {
        console.log(`[JS Action Fix] User '${userName}' not in cache. Fetching new summary data...`);
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        try {
            const res = await window.pywebview.api.fetch_monthly_summary(year, month);
            if (res.status === 'ok' && res.payload) {
                window.monthlySummaryCache = res.payload; // Update cache
                data = (res.payload || []).find(p => p.name === userName); // Find user again
                console.log(`[JS Action Fix] Cache updated. Found data for '${userName}':`, data);
            }
        } catch (err) {
            console.error("[JS Action Fix] Failed to fetch summary on demand:", err);
            data = null; // Ensure data is null on error
        }
    }
    // --- END: แก้ไข Action Button Bug ---

    if (data) {
        if (totalClips) totalClips.textContent = `${data.totalClips} คลิป`;
        if (totalMissing) totalMissing.textContent = `${data.totalMissing} ครั้ง`;
        if (totalHolidays) totalHolidays.textContent = `${data.totalHolidays} วัน`;
        if (totalViews) totalViews.textContent = `N/A`; // ตามที่คุยกัน

        detail_generateDailyCalendarTable(data.dailyData);
        detail_addTooltipListeners();
    } else {
        if (totalClips) totalClips.textContent = 'N/A';
        if (totalMissing) totalMissing.textContent = 'N/A';
        if (totalHolidays) totalHolidays.textContent = 'N/A';
        if (totalViews) totalViews.textContent = 'N/A';
        if (calendarTbody) calendarTbody.innerHTML = '<tr><td colspan="32" style="text-align:center; padding: 20px;">ไม่พบข้อมูลสำหรับผู้ใช้นี้ (อาจต้องกลับไปหน้าสรุปรวมก่อน)</td></tr>';
    }
}



function detail_generateDailyCalendarTable(dailyData) {
    const calendarTbody = document.getElementById('calendar-tbody');
    let tableRowsHtml = `
        <tr>
            <td>ส่งคลิป</td>
            ${detail_generateDailyCells(dailyData, 'clips')}
        </tr>
        <tr>
            <td>สถานะ</td>
            ${detail_generateDailyCells(dailyData, 'status')}
        </tr>
    `;
    if (calendarTbody) calendarTbody.innerHTML = tableRowsHtml;
}

function detail_generateDailyCells(dailyData, type) {
    let cellsHtml = '';
    const daysInMonth = 31;
    for (let i = 1; i <= daysInMonth; i++) {
        const dayInfo = dailyData[i] || { status: 'nodata', text: '' };
        let content = '';
        let statusClass = `status-daily-${dayInfo.status}`;
        if (type === 'clips') {
            content = dayInfo.clips !== undefined ? dayInfo.clips : '';
        } else if (type === 'status') {
            content = dayInfo.text || (dayInfo.status === 'missing' ? 'ขาด' : dayInfo.status === 'holiday' ? 'หยุด' : '');
        }
        cellsHtml += `
            <td class="${statusClass} daily-cell-info"
                data-day="${i}"
                data-status="${dayInfo.status}"
                data-clips="${dayInfo.clips || ''}"
                data-text="${dayInfo.text || ''}">
                ${content}
            </td>`;
    }
    return cellsHtml;
}

// ... (ฟังก์ชัน detail_applyStickyColumns, และ Tooltip เหมือนเดิม) ...
function detail_applyStickyColumns(tableSelector) {
    const table = document.querySelector(tableSelector);
    if (!table) return;
    const firstColHeaders = table.querySelectorAll('th:first-child');
    const firstColDataCells = table.querySelectorAll('td:first-child');
    firstColHeaders.forEach(cell => { cell.style.position = 'sticky'; cell.style.left = '0'; });
    firstColDataCells.forEach(cell => { cell.style.position = 'sticky'; cell.style.left = '0'; });
}

let detail_currentTooltip = null;
function detail_addTooltipListeners() {
    const cells = document.querySelectorAll('.daily-cell-info');
    cells.forEach(cell => {
        cell.addEventListener('mouseenter', detail_showTooltip);
        cell.addEventListener('mouseleave', detail_hideTooltip);
        cell.addEventListener('mousemove', detail_updateTooltipPosition);
    });
}
function detail_showTooltip(event) {
    const cell = event.currentTarget;
    if (detail_currentTooltip) { document.body.removeChild(detail_currentTooltip); }
    const tooltip = document.createElement('div');
    tooltip.className = 'daily-cell-tooltip-dynamic';
    const day = cell.dataset.day;
    let content = `สถานะ: ${cell.dataset.status}<br>วันที่: ${day}`;
    if(cell.dataset.clips) content += `<br>คลิป: ${cell.dataset.clips}`;
    tooltip.innerHTML = content;
    document.body.appendChild(tooltip);
    detail_updateTooltipPosition(event);
    tooltip.style.opacity = '1';
    tooltip.style.visibility = 'visible';
    detail_currentTooltip = tooltip;
}
function detail_updateTooltipPosition(event) {
    if (!detail_currentTooltip) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const tooltipHeight = detail_currentTooltip.offsetHeight;
    const tooltipWidth = detail_currentTooltip.offsetWidth;
    let top = rect.top - tooltipHeight - 10 + window.scrollY;
    let left = rect.left + (rect.width / 2) - (tooltipWidth / 2) + window.scrollX;
    if (top < window.scrollY) { top = rect.bottom + 10 + window.scrollY; }
    if (left < 0) left = 5;
    if (left + tooltipWidth > window.innerWidth) left = window.innerWidth - tooltipWidth - 5;
    detail_currentTooltip.style.left = `${left}px`;
    detail_currentTooltip.style.top = `${top}px`;
}
function detail_hideTooltip() {
    if (detail_currentTooltip) {
        if (detail_currentTooltip.parentNode) {
            detail_currentTooltip.parentNode.removeChild(detail_currentTooltip);
        }
        detail_currentTooltip = null;
    }
}


// ==== Dispatcher Function ====
function loadSummaryView(viewName, userName = null) {
  if (viewName === 'monthly-summary') {
    initMonthlySummaryView();
  } else if (viewName === 'summary-detail') {
    initDetailSummaryView(userName);
  } else if (viewName === 'leaves') { // เพิ่มเงื่อนไขสำหรับแถบ Leaves
    initLeavesView();
  }
}

// summary_views.js

// เก็บ instance ของ Flatpickr ไว้ใช้
let leavesFlatpickrInstance;
let isLeavesViewInitialized = false;

function initLeavesView() {
  // ถ้าเคย initialize แล้ว ให้แค่ fetch ข้อมูลสำหรับวันปัจจุบัน/วันที่เลือก
  if (isLeavesViewInitialized) {
    const sel = leavesFlatpickrInstance.selectedDates[0] || new Date();
    fetchAndPopulateLeaves(sel);
    return;
  }

  // 1) หา element ต่างๆ
const calendarBtn = document.getElementById('leaves-calendar-button');
const pickerInput  = document.getElementById('leaves-date-picker');
const displayEl    = document.getElementById('current-date-display');
const today        = new Date();
  // 2) แสดงวันที่ปัจจุบันบน UI
  if (displayEl) {
    displayEl.textContent = `ส่งคลิปประจำวันที่ ${today.getDate()}/${today.getMonth()+1}/${today.getFullYear()}`;
  }

  // 3) ตรวจว่ามี flatpickr และ element ครบ
  if (!window.flatpickr || !pickerInput || !calendarBtn) {
    console.warn('Leaves: flatpickr หรือ HTML hooks ไม่ครบ');
    return;
  }

  // 4) ติดตั้ง Flatpickr ครั้งแรก
leavesFlatpickrInstance = flatpickr(
  document.getElementById('leaves-date-picker'),
  {
    locale: 'th',
    defaultDate: new Date(),
    dateFormat: 'd-m-Y',
    positionElement: document.getElementById('leaves-calendar-button'),
    onChange: ([sel]) => {
      if (!sel) return;
      document.getElementById('current-date-display').textContent =
        `ส่งคลิปประจำวันที่ ${sel.getDate()}/${sel.getMonth()+1}/${sel.getFullYear()}`;
      fetchAndPopulateLeaves(sel);
    }
  }
);

// 5) ผูกปุ่ม “ปฏิทิน” ให้เปิด Flatpickr
document
  .getElementById('leaves-calendar-button')
  .addEventListener('click', () => leavesFlatpickrInstance.open());

  // 6) โหลดข้อมูลครั้งแรกสำหรับวันนี้
  fetchAndPopulateLeaves(today);

  isLeavesViewInitialized = true;
}

// ฟังก์ชันดึงและแสดงข้อมูลวันนั้นๆ
async function fetchAndPopulateLeaves(date) {
  const tbody = document.getElementById('leaves-table-body');
  tbody.innerHTML = `<tr><td colspan="12" class="text-center p-4">กำลังดึงข้อมูล…</td></tr>`;

  // 1) ดึงรายวัน (ที่มีอยู่แล้ว)
  const year  = date.getFullYear();
  const month = date.getMonth() + 1;
  const day   = date.getDate();
  const dailyRes = await window.pywebview.api.fetch_leaves_list(year, month, day);
  if (dailyRes.status !== 'ok') {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center p-4">ไม่พบข้อมูล: ${dailyRes.message}</td></tr>`;
    return;
  }
  const daily = dailyRes.payload; // [{ name, projectName, …, statusToday }, …]

  // 2) ดึงข้อมูลภาพรวมเดือน (TotalSent, สถานะ) จาก Monthly_Summary
  const monthlyRes = await window.pywebview.api.get_monthly_summary_rows(year, month);
  const monthly = monthlyRes.status === 'ok'
    ? monthlyRes.payload
    : [];
  // สร้าง map: projectName → { TotalSent, สถานะ }
  const monthMap = {};
  for (const row of monthly) {
    monthMap[row.SheetName] = {
      totalSent: row.TotalSent,
      status:    row.สถานะ,       // ถ้าคอลัมน์ชื่อ K เป็น header “สถานะ”
    };
  }

  // 3) สร้าง table rows ใหม่
  tbody.innerHTML = daily.map((item, i) => {
    const m = monthMap[item.projectName] || {};
    return `
      <tr>
        <td>${i+1}</td>
        <td>${item.name}</td>
        <td>${item.projectName}</td>
        <td>${m.totalSent ?? 0} คลิป</td>
        <td class="${m.status==='ส่งครบ' ? 'text-green-600' : 'text-red-600'}">
          ${m.status || 'ยังไม่ส่ง'}
        </td>
        <td>${item.platform}</td>
        <td>${item.dailyTarget.toLocaleString()} คลิป</td>
        <td>${item.totalSentThisMonth.toLocaleString()} คลิป</td>
        <td>${item.leaveDays || 'N/A'}</td>
        <td>${item.missingDays || 0} วัน</td>
        <td>${item.missingClips || 0} คลิป</td>
        <td>
          <button class="btn-view-detail" data-name="${item.name}">ดูภาพรวม</button>
        </td>
      </tr>`;
  }).join('');
}


// เมื่อตัว PyWebView พร้อม inject api ให้เรียก initLeavesView
window.addEventListener('pywebviewready', () => {
  initLeavesView();
});


