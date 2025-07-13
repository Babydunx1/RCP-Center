// === Global state ===
let allPagesData = [];
let allTransactionsData = [];
let allReelsData = []; // เก็บข้อมูลงานที่ดึงมาจาก Google Sheet (สำหรับหน้าลงงาน)
let allStaffsData = []; // ✅ เก็บข้อมูล Staffs ไว้ใน Global State

let currentUser = null;
let projectMap = {}; // projectId => SheetName
let currentProjectId = null;
let currentProjectSheetName = ''; // ✅ ตั้งค่าเริ่มต้นเป็นสตริงว่างเปล่า

// === Helper ===
const getVal = (obj, field) => {
  const key = Object.keys(obj).find(k => k.trim().toLowerCase() === field.toLowerCase());
  const value = key ? obj[key] : undefined;
  return typeof value === 'string' ? value.trim() : value;
};


// ➤ เพิ่มตัวแปรเก็บ cache ของแต่ละโปรเจกต์ (วางเหนือทุกโค้ดในไฟล์)
const projectDataCache = {};


// === Display Name Helper (unified for all UI points) ===
function getDisplayName(user) {
  if (!user) return '-';
  // 1. Try to combine first/last name fields (case-insensitive, fallback to Name field only if both first/last missing)
  const firstName = getVal(user, 'First Name') || getVal(user, 'first_name') || '';
  const lastName = getVal(user, 'Last Name') || getVal(user, 'last_name') || '';
  if (firstName || lastName) {
    return (firstName + (lastName ? ' ' + lastName : '')).trim();
  }
  // 2. Prefer explicit profile name if present (used in new profile system)
  if (user.name && typeof user.name === 'string' && user.name.trim() && user.name !== user.email) {
    return user.name.trim();
  }
  // 3. Fallback: use Name field (if not already used above)
  const onlyName = getVal(user, 'Name');
  if (onlyName && typeof onlyName === 'string' && onlyName.trim() && onlyName !== user.email) {
    return onlyName.trim();
  }
  // 4. Fallback: use email prefix (before @) if no name at all
  if (user.email && typeof user.email === 'string' && user.email.includes('@')) {
    return user.email.split('@')[0];
  }
  return '-';
}

// === LOGIN FLOW ===
function showLoginModal() {
  const loginView = document.getElementById('view-login');
  loginView?.classList.remove("hidden-view");
  loginView?.removeAttribute('aria-hidden');

  const appContainer = document.getElementById('app-container');
  appContainer?.classList.add("hidden-view");
}

function hideLoginModal() {
  const loginView = document.getElementById('view-login');
  loginView?.classList.add("hidden-view");

  const appContainer = document.getElementById('app-container');
  appContainer?.classList.remove("hidden-view");
}

// ====================================================================================
//  VIEW MANAGEMENT (GLOBAL SCOPE)
//  Moved to global scope to prevent race conditions between pywebviewready and DOMContentLoaded.
// ====================================================================================
const views = {};

const adminViews = [
    'admin-dashboard', 'staffs', 'leaves', 'salary', 'stats', 'notifications', 'export', 'settings'
];

// This function is now globally available and safe to be called by initApp.
window.switchView = (target) => {
    // Lazy-load view elements on first call to ensure DOM is ready.
    if (Object.keys(views).length === 0) {
        console.log("[JS DEBUG] First run of switchView, mapping view elements.");
        // List all view IDs that exist in your HTML and need to be managed by switchView
        const viewIds = [
            'home', 'work', 'team', 'profile', 
            'admin-dashboard', 'staffs', 'leaves', 'salary', 'stats', 'notifications', 'export', 'settings', 
            'monthly-summary', 'summary-detail' // These IDs are now present in rcp_dashboard.html
        ];
        viewIds.forEach(id => {
            views[id] = document.getElementById(`view-${id}`);
            if (!views[id]) {
                console.warn(`[JS WARNING] View element with ID 'view-${id}' not found in DOM.`);
            }
        });
    }

    // Prevent non-admins from accessing admin views
    if (currentUser && currentUser.Role !== 'Admin' && adminViews.includes(target)) {
        Swal.fire('Access Denied', 'คุณไม่มีสิทธิ์เข้าถึงหน้านี้', 'error');
        console.warn(`[JS WARNING] Access denied for non-admin to view: ${target}`);
        return;
    }

    // Toggle visibility
    Object.keys(views).forEach(v => {
        if (views[v]) {
            const isTargetView = (v === target);
            views[v].classList.toggle('hidden-view', !isTargetView);
            // Optional: for debugging, log the display state
            console.log(`[JS DEBUG] View 'view-${v}' visibility set to: ${isTargetView ? 'visible' : 'hidden'} (classList.contains('hidden-view'): ${views[v].classList.contains('hidden-view')})`);
        }
    });
    console.log(`[JS DEBUG] Switched to view: ${target}`);
};

// === SweetAlert2 Helper for Login Errors ===
function showLoginErrorPopup(message) {
    Swal.fire({
        icon: 'error',
        title: 'เข้าสู่ระบบไม่สำเร็จ!',
        text: message,
        confirmButtonText: 'ตกลง',
        customClass: {
            container: 'swal2-container',
            popup: 'swal2-popup',
            header: 'swal2-header',
            title: 'swal2-title',
            closeButton: 'swal2-close',
            icon: 'swal2-icon',
            image: 'swal2-image',
            content: 'swal2-content',
            htmlContainer: 'swal2-html-container',
            actions: 'swal2-actions',
            confirmButton: 'swal2-confirm',
            cancelButton: 'swal2-cancel',
            footer: 'swal2-footer'
        }
    });
}

// ✅ Modified handleLoginClick to use showLoginErrorPopup
async function handleLoginClick(e) {
  e?.preventDefault?.();
  const emailInput = document.getElementById('login-email-input');
  const loginBtn = document.getElementById('login-btn'); // Get login button reference here

  if (!emailInput) {
      showLoginErrorPopup('ไม่พบช่องกรอกอีเมล');
      return;
  }

  const email = emailInput.value.trim();
  if (!email) {
      showLoginErrorPopup('กรุณากรอกอีเมล');
      return;
  }

  // Show loading state on button
  if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังเข้าสู่ระบบ...';
  }

  console.log("[JS DEBUG] Attempting login for email:", email);
  try {
    const rememberMe = document.getElementById('remember-me')?.checked;
    const res = await window.pywebview.api.login(email, rememberMe);
    console.log("[JS DEBUG] API Response from login:", res);

    if (res.status === "ok") {
      console.log("[JS DEBUG] Login success", res.payload);
      hideLoginModal();
      initApp(res.payload);
      document.getElementById("app-container").style.display = "block";
    } else {
      // Use SweetAlert2 for login failure
      showLoginErrorPopup(res.message || 'เกิดข้อผิดพลาดขณะเข้าสู่ระบบ');
    }
  } catch (err) {
    console.error("[JS ERROR] Login error:", err);
    showLoginErrorPopup('เกิดข้อผิดพลาดขณะเข้าสู่ระบบ: ' + err.message);
  } finally {
      // Restore button state
      if (loginBtn) {
          loginBtn.disabled = false;
          loginBtn.innerHTML = 'ดำเนินการต่อ';
      }
  }
}

// ====== AUTO LOGIN (Remember Me) ======
// ให้เหลือ event listener pywebviewready แค่ตัวเดียว
window.addEventListener('pywebviewready', async () => {
  // --- Step 1: Pre-load essential data (Staffs) ---
  // This is critical for initApp to correctly determine the initial project.
  // We wrap this in its own try-catch so a failure here doesn't block auto-login.
  try {
    console.log('[JS DEBUG] pywebviewready: Pre-loading staffs data...');
    const staffsRes = await window.pywebview.api.fetch_staffs_data('https://docs.google.com/spreadsheets/d/17lOtuHum9VHdukfHr7143uCGydVZSaJNi2RhzGfh81g/edit?gid=1356715801#gid=1356715801');
    if (staffsRes.status === 'ok') {
      window.allStaffsData = staffsRes.payload || [];
      console.log('[JS DEBUG] pywebviewready: Successfully pre-loaded staffs data. Count:', window.allStaffsData.length);
    } else {
      console.warn('[JS WARNING] pywebviewready: Could not pre-load staffs data:', staffsRes.message);
      window.allStaffsData = []; // Ensure it's an empty array on failure
    }
  } catch (err) {
    console.error('[JS ERROR] Failed to pre-load staffs data. This might affect initial project selection, but auto-login will proceed.', err);
    window.allStaffsData = []; // Critical: ensure it's an empty array on any error
  }

  // --- Step 2: Attempt auto-login ---
  // This part now runs regardless of whether the staff data load succeeded.
  try {
    console.log('[JS DEBUG] pywebviewready: Checking for auto-login...');
    const res = await window.pywebview.api.auto_login();
    if (res.status === 'ok') {
      console.log('[JS DEBUG] auto_login success. Initializing app.');
      hideLoginModal();
      initApp(res.payload);
      document.getElementById("app-container").style.display = "block";
      return; // Exit successfully
    }
    console.log('[JS DEBUG] auto_login failed or no remembered user.');
  } catch (e) {
    console.error('[JS ERROR] Error during auto_login API call:', e);
  }

  // --- Step 3: Fallback to showing the login modal ---
  showLoginModal();
  requestAnimationFrame(() => setupLoginButton());
});

window.handleLoginClick = handleLoginClick; // Make it globally accessible

function setupLoginButton() {
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    console.log('[JS DEBUG] login button found and event attached');
    loginBtn.removeEventListener('click', handleLoginClick); // Remove existing listener to prevent duplicates
    loginBtn.addEventListener('click', handleLoginClick);
  } else {
    console.warn('[JS WARNING] login button not found');
  }
}

function ready(fn) {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

let flatpickrInstance; // ประกาศตัวแปรนี้ไว้นอกฟังก์ชันเพื่อให้เข้าถึงได้ทั่วถึง

function waitForFlatpickr(timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      // ✅ ตรวจสอบ flatpickrInstance และ selectedDates ให้แน่ใจว่าพร้อม
      if (flatpickrInstance && flatpickrInstance.selectedDates) return resolve();
      if (Date.now() - start > timeout) return reject('Timeout waiting for flatpickr');
      setTimeout(check, 50);
    })();
  });
}



// ✅ ฟังก์ชันหลักหลัง login
function initApp(user) {
  currentUser = user;
  projectMap = user.ProjectMap || {};
  console.log('[JS DEBUG] initApp: currentUser:', currentUser);
  console.log('[JS DEBUG] initApp: ProjectMap:', projectMap);

  const projRoot = document.getElementById('sidebar-projects');
  if (projRoot) {
    projRoot.innerHTML = '';
    (user.AllowedProjects || []).forEach(pid => {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = projectMap[pid] || pid; // Display original sheet name
      a.dataset.projectId = pid; // Store canonical ID
      a.addEventListener('click', () => loadProject(pid));
      projRoot.appendChild(a);
    });
  }

  populateProfileView(user);
  // Load profile data immediately after login
  if (window.loadProfileDataOnLogin) {
      window.loadProfileDataOnLogin();
  }

  // Wait for flatpickr, then load the correct project for admin or first allowed project for others
  waitForFlatpickr().then(() => {
    let initialProjectId = null;
    let initialProjectSheetName = '';

    if (user.AllowedProjects?.length > 0) {
      // --- หาว่า user มีโปรเจกต์ที่ตัวเองเป็นเจ้าของหรือไม่ (owner/email/sheetName) ---
      const userEmail = (user["E-Mail"] || "").trim().toLowerCase();
      let foundOwnProject = false;
      for (const pid of user.AllowedProjects) {
        const proj = user.ProjectMap[pid];
        // 1) กรณี ProjectMap[pid] เป็น object และมี owner
        if (proj && typeof proj === 'object' && proj.owner) {
          const ownerEmail = String(proj.owner).trim().toLowerCase();
          if (ownerEmail === userEmail) {
            initialProjectId = pid;
            initialProjectSheetName = proj.sheetName || proj.name || pid;
            foundOwnProject = true;
            break;
          }
        }
        // 2) กรณี ProjectMap[pid] เป็น string (sheet name) และชื่อ sheet ตรงกับ Project Name ในชีต (case-insensitive)
        if (proj && typeof proj === 'string') {
          // ดึง Project Name จาก row ในชีตที่ email ตรงกับ user
          let projectNameFromSheet = null;
          if (Array.isArray(window.allStaffsData)) {
            const staffRow = window.allStaffsData.find(row => {
              const emailCell = (row['E-Mail'] || row['Email'] || '').trim().toLowerCase();
              return emailCell === userEmail;
            });
            if (staffRow && staffRow['Project Name']) {
              projectNameFromSheet = String(staffRow['Project Name']).trim();
            }
          }
          // เปรียบเทียบแบบ case-insensitive
          if (projectNameFromSheet && projectNameFromSheet.toLowerCase() === proj.trim().toLowerCase()) {
            initialProjectId = pid;
            initialProjectSheetName = proj;
            foundOwnProject = true;
            break;
          }
        }
      }
      // Fallback: ถ้าไม่เจอโปรเจกต์ตัวเอง ให้ใช้ project แรก
      if (!foundOwnProject) {
        initialProjectId = user.AllowedProjects[0];
        const proj = user.ProjectMap[initialProjectId];
        initialProjectSheetName = (proj && typeof proj === 'object') ? (proj.sheetName || proj.name || initialProjectId) : (proj || initialProjectId);
      }

      window.currentProjectId = initialProjectId;
      window.currentProjectSheetName = initialProjectSheetName;
      console.log(`[JS DEBUG] initApp: Initial project - ID: ${window.currentProjectId}, Sheet Name: ${window.currentProjectSheetName}`);

      // ————— Preload ข้อมูล Staffs ล่วงหน้า (cache) —————
        const staffSheetUrl = 'https://docs.google.com/spreadsheets/d/17lOtuHum9VHdukfHr7143uCGydVZSaJNi2RhzGfh81g/edit?gid=1356715801#gid=1356715801';
        window.pywebview.api.fetch_staffs_data(staffSheetUrl)
            .then(res => {
            window.allStaffsData = Array.isArray(res.payload) ? res.payload : [];
            console.log('[JS DEBUG] Preloaded staffs data:', window.allStaffsData.length);
            })
            .catch(err => console.error('[JS ERROR] Preload staffs failed:', err));
    // ————————————————————————————————————————

      // โหลดข้อมูลสำหรับ project ที่เลือก
        loadProject(window.currentProjectId)
            .then(() => {
            // หลังจาก fetch โปรเจกต์เสร็จ สลับ view ไปหน้า Home
            window.switchView('home');
            });
    } else {
      // No allowed projects, show a message and hide work view
      const workView = document.getElementById('view-work');
      if (workView) workView.classList.add('hidden-view');
      Swal.fire('No Projects', 'คุณไม่มีสิทธิ์เข้าถึงโปรเจกต์ใด ๆ', 'info');
    }
  }).catch(err => {
      console.error("[JS ERROR] initApp: Flatpickr or initial project load failed:", err);
      Swal.fire('Error', 'เกิดข้อผิดพลาดในการเริ่มต้นโปรแกรม: ' + err, 'error');
  });
}

// ✅ โหลดข้อมูลโปรเจกต์

function loadProject(projectId) {
  console.log('[JS DEBUG] loadProject called with projectId:', projectId);
  console.log('[JS DEBUG] currentUser.AllowedProjects:', currentUser?.AllowedProjects);
  console.log('[JS DEBUG] projectMap:', projectMap);

  // ————— ถ้ามี cache ของโปรเจกต์นี้อยู่ ให้ใช้ทันที —————
  if (projectDataCache[projectId]) {
    console.log('[JS DEBUG] Using cached data for project:', projectId);
    const cached = projectDataCache[projectId];
    window.allReelsData = cached.reels || [];
    _renderWorkTableFromCache();  // ดูฟังก์ชันย่อยข้างล่าง
    return Promise.resolve();
  }

  // ————— เช็คสิทธิ์ก่อน —————
  if (!currentUser?.AllowedProjects?.includes(projectId)) {
    Swal.fire('Access Denied', 'คุณไม่มีสิทธิ์เข้าถึงโปรเจกต์นี้', 'error');
    return Promise.reject(new Error('Access Denied'));
  }

  // Set globals
  window.currentProjectId = projectId;
  window.currentProjectSheetName = projectMap[projectId] || '';
  console.log('[JS DEBUG] currentProjectSheetName:', window.currentProjectSheetName);

  // === อัพเดตชื่อโปรเจกต์บน UI ===
  _updateProjectHeaderUI();

  // === เรียก Python API ===
  return window.pywebview.api.fetch_employee_data(projectId)
    .then(res => {
      if (res.status !== 'ok') {
        Swal.fire('Error', res.message, 'error');
        console.error('[JS ERROR] fetch_employee_data failed:', res.message);
        return Promise.reject(new Error(res.message));
      }

      // เก็บ cache
      projectDataCache[projectId] = res.payload;

      window.allReelsData = res.payload.reels || [];
      console.log('[JS DEBUG] allReelsData count:', window.allReelsData.length);

      // แสดงตารางงาน
      _renderWorkTable();
      return Promise.resolve();
    })
    .catch(err => {
      console.error('[JS ERROR] fetch_employee_data error:', err);
      Swal.fire('Error', 'ไม่สามารถโหลดข้อมูลได้: ' + err.message, 'error');
      return Promise.reject(err);
    });
}

// ————— ฟังก์ชันช่วยเหลือสำหรับ render ตาราง —————
function _renderWorkTable() {
  // ตั้ง Flatpickr ให้เลือกวันนี้ถ้ายังไม่มี
  if (flatpickrInstance && (!flatpickrInstance.selectedDates || !flatpickrInstance.selectedDates.length)) {
    flatpickrInstance.setDate(new Date(), true);
  }
  const dateToUse = flatpickrInstance?.selectedDates?.[0] || new Date();
  console.log('[JS DEBUG] Populating work table with:', dateToUse, window.currentProjectSheetName);
  if (typeof populateWorkTable === 'function') {
    populateWorkTable(dateToUse, window.currentProjectSheetName);
  }
}

function _renderWorkTableFromCache() {
  // เหมือน _renderWorkTable แต่ใช้ projectId แทน sheetName
  if (flatpickrInstance && (!flatpickrInstance.selectedDates || !flatpickrInstance.selectedDates.length)) {
    flatpickrInstance.setDate(new Date(), true);
  }
  const dateToUse = flatpickrInstance?.selectedDates?.[0] || new Date();
  console.log('[JS DEBUG] Populating work table from cache with:', dateToUse, window.currentProjectId);
  if (typeof populateWorkTable === 'function') {
    populateWorkTable(dateToUse, window.currentProjectId);
  }
}

function _updateProjectHeaderUI() {
  const nameEl = document.getElementById('current-project-name');
  const lastEl = document.getElementById('project-last-update');
  if (nameEl) {
    const proj = projectMap[window.currentProjectId];
    nameEl.textContent = (proj && proj.tab) ? proj.tab : window.currentProjectId;
  }
  if (lastEl) {
    const now = new Date();
    const d = now.toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' });
    const t = now.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
    lastEl.textContent = `อัปเดตล่าสุด: ${d} ${t}`;
  }
}
// Update greeting in "ลงงาน" card: ใช้ getDisplayName() เดียวกับทุกจุดจริง ๆ
  const waitForProfile = setInterval(() => {
  const profile = window.profileData;
  const name = getDisplayName(profile);

  if (profile && name && name !== '-') {
    const greetingElem = document.getElementById('greeting-user-name');
    if (greetingElem) {
      greetingElem.textContent = `สวัสดี, ${name} 👋`;
    }
    clearInterval(waitForProfile);
  }
}, 300); // เช็คทุก 300ms

function populateProfileView(user) {
  // Use the new profile-content div if it exists, otherwise fallback to old fields
  const profileDiv = document.getElementById('profile-content');
  if (profileDiv) {
    const email = user["E-Mail"] || "-";
    const role = user["Role"] || "-";
    let projects = (user.AllowedProjects || [])
      .map(pid => projectMap[pid] || pid) // Map canonical ID back to original sheet name
      .filter(Boolean)
      .join(', ');
    if (!projects) {
      projects = '<span class="text-gray-400">ไม่มีสิทธิ์เข้าถึงโปรเจกต์ใด ๆ</span>';
    }
    profileDiv.innerHTML = `
      <p><strong>อีเมล:</strong> ${email}</p>
      <p><strong>บทบาท:</strong> ${role}</p>
      <p><strong>สิทธิ์เข้าถึงโปรเจกต์:</strong> ${projects}</p>
    `;
  } else {
    // fallback for legacy fields (if any)
    console.warn("[JS WARNING] #profile-content not found. Using fallback for profile view.");
  }
}

// ===== ฟังก์ชันแสดงข้อมูลตาราง "ลงงาน" (Work Table) =====
function populateWorkTable(dateObject, sheetNameForTable) {
    console.log("[JS DEBUG] populateWorkTable called with date:", dateObject, "and received sheetNameForTable:", sheetNameForTable); // ✅ NEW LOG
    if (!(dateObject instanceof Date) || isNaN(dateObject.getTime())) { // Check for valid Date object
        console.warn("[JS WARNING] populateWorkTable received invalid dateObject. Using current date.");
        dateObject = new Date();
    }

    // Format date to match Google Sheet's "D/M/YYYY", "DD/M/YYYY", "D/MM/YYYY", "DD/MM/YYYY"
    // and also "D/M/YY", "DD/M/YY", "D/MM/YY", "DD/MM/YY"
    const day = dateObject.getDate();
    const month = dateObject.getMonth() + 1;
    const yearFull = dateObject.getFullYear();
    const yearShort = (dateObject.getFullYear() % 100); // Get last two digits of year

    // Generate possible formats for filtering
    const dateFormatsToMatch = [
        `${day}/${month}/${yearFull}`, // e.g., "1/7/2025"
        `${day.toString().padStart(2, '0')}/${month}/${yearFull}`, // e.g., "01/7/2025"
        `${day}/${month.toString().padStart(2, '0')}/${yearFull}`, // e.g., "1/07/2025"
        `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${yearFull}`, // e.g., "01/07/2025"
        `${day}/${month}/${yearShort}`, // e.g., "1/7/25"
        `${day.toString().padStart(2, '0')}/${month}/${yearShort}`, // e.g., "01/7/25"
        `${day}/${month.toString().padStart(2, '0')}/${yearShort}`, // e.g., "1/07/25"
        `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${yearShort}` // e.g., "01/07/25"
    ];

    // ✅ เลือกรูปแบบการแสดงผลที่ชัดเจนที่สุด
    const dateToDisplay = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${yearFull}`;

    console.log("[JS DEBUG] Filtering reels for date (possible formats):", dateFormatsToMatch.join(', '));
    console.log("[JS DEBUG] All Reels Data (before filter):", window.allReelsData);

    const reels = window.allReelsData || [];
    // Debug: log all dates in data to see what's actually there
    const allDatesInRawData = reels.map(r => r["Date"]).filter(Boolean);
    console.log("[JS DEBUG] All 'Date' values in raw allReelsData:", allDatesInRawData);

    const reelRows = reels.filter(r => {
        const d = (r["Date"] || '').trim();
        // Check if the date in the row matches any of the generated formats
        return dateFormatsToMatch.includes(d);
    });

    console.log("[JS DEBUG] Filtered Reel Rows for current date:", reelRows);

    const tbody = document.getElementById('work-rows');
    const dateHeader = document.getElementById('current-date');
    if (!tbody || !dateHeader) {
        console.error("[JS ERROR] populateWorkTable: tbody or dateHeader not found.");
        return;
    }
    dateHeader.textContent = dateToDisplay;

    if (!reelRows.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-gray-500 py-4">ไม่พบข้อมูลคลิปในวันที่ ${dateToDisplay}</td></tr>`;
        console.log("[JS DEBUG] No reel rows found for this date.");
        return;
    }

    // Helper function to get platform HTML based on FB/IG values from the row
    const getPlatformHtmlFromRow = (row) => {
        const hasFB = String(getVal(row, 'FB') ?? '0').trim() === '1';
        const hasIG = String(getVal(row, 'IG') ?? '0').trim() === '1';

        let platformHtml = '';
        if (hasFB) {
            platformHtml += `<span class=\"fb-badge\">FB</span>`;
        }
        if (hasIG) {
            platformHtml += `<span class=\"ig-badge\">IG</span>`;
        }
        return platformHtml || '-';
    };

    tbody.innerHTML = reelRows.map((row, idx) => `
        <tr>
            <td class="text-center">${row["No"] || idx + 1}</td>
            <td>${row["PageName"] || '-'}</td>
            <td>${getPlatformHtmlFromRow(row)}</td>
            <td>${linkCell(row["Clip1"])}</td>
            <td>${linkCell(row["Clip2"])}</td>
            <td>${linkCell(row["View1"])}</td>
            <td>${linkCell(row["View2"])}</td>
            <td>${row["Status"] || '-'}</td>
        </tr>
    `).join('');
    console.log("[JS DEBUG] Work table populated successfully.");
}

// --- ฟังก์ชันย่อยสร้างลิงก์
function linkCell(url) {
    if (!url || url === "-" || url.trim() === "") {
        return `<span class="text-gray-400">-</span>`;
    }
    // Check if it's a number (for View1/View2)
    if (!isNaN(url) && !isNaN(parseFloat(url))) {
        return Number(url).toLocaleString(); // Format numbers like 123,456
    }
    return `<a href="${url}" target="_blank"
        class="underline text-blue-600 hover:text-blue-900 whitespace-nowrap overflow-hidden text-ellipsis block max-w-[170px]">
        ${url}
    </a>`;
}

// -- Quick Action functions (หน้า home)
function requestLeave() {
    Swal.fire({
        title: '<strong>แจ้งความประสงค์<u>ลางาน</u></strong>', icon: 'info',
        html: `<p>กรุณาเลือกประเภทการลาและระบุวันที่</p><select id="leave-type" class="swal2-select mt-2"><option value="sick">ลาป่วย</option><option value="personal">ลากิจ</option><option value="vacation">ลาพักร้อน</option></select>`,
        showCloseButton: true, showCancelButton: true,
        confirmButtonText: '<i class="fa fa-paper-plane"></i> ส่งคำขอ',
        cancelButtonText: 'ยกเลิก',
    }).then(result => { if (result.isConfirmed) { Swal.fire('ส่งสำเร็จ!', 'คำขอของคุณถูกส่งแล้ว รอการอนุมัติ', 'success') } });
}
function showAnnouncements() { Swal.fire({ title: 'ประกาศจากบริษัท', icon: 'warning', html: `<div class="text-left p-2"><div class="p-3 mb-2 bg-blue-50 rounded-lg"><p class="font-bold">ประชุมใหญ่ไตรมาส 3</p><p class="text-sm">วันศุกร์ที่ 28 มิ.ย. เวลา 10:00น.</p></div></div>` }); }
function showLeaveSummary() { Swal.fire({ title: 'สรุปวันลาของคุณ', icon: 'success', html: `<ul class="text-left space-y-2 p-4"><li class="flex justify-between"><span>ลาพักร้อนคงเหลือ:</span><span class="font-bold">10 วัน</span></li><li class="flex justify-between"><span>ลาป่วยใช้ไป:</span><span class="font-bold">2 วัน</span></li><li class="flex justify-between"><span>ลากิจใช้ไป:</span><span class="font-bold">1 วัน</span></li></ul>` }); }
function showHolidays() { Swal.fire({ title: 'วันหยุดประจำปี 2568', icon: 'info', html: `<ul class="text-left space-y-2 p-4"><li class="flex justify-between"><span>วันมาฆบูชา:</span><span class="font-bold text-red-600">24 ก.พ.</span></li><li class="flex justify-between"><span>วันสงกรานต์:</span><span class="font-bold text-red-600">13-15 เม.ย.</span></li></ul>` }); }


// --- Date/Time Display ---
function updateDateTime() {
    const now = new Date();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const dateStr = now.toLocaleDateString('th-TH', dateOptions);
    const timeStr = now.toLocaleTimeString('th-TH', timeOptions);

    const dateDisplayHome = document.getElementById('date-display-home');
    const timeDisplayHome = document.getElementById('time-display-home');

    if (dateDisplayHome) dateDisplayHome.textContent = dateStr;
    if (timeDisplayHome) timeDisplayHome.textContent = timeStr;
}


// ✅ เปลี่ยนชื่อฟังก์ชันจาก handle_python_callback เป็น handle_python_callback_old
// เพื่อไม่ให้ชนกับ handle_python_callback ใน script.js
function handle_python_callback_old(response) {
    if (response.type === "sheet_data_response") {
        window.allPageLinks = response.payload.page_links || [];
        window.allReelsData = response.payload.reels || [];
        window.allTransactionsData = response.payload.transactions || [];

        if (window.allReelsData && window.allReelsData.length > 0) {
            // เอาวันล่าสุดในข้อมูล (format: "26-06-68")
            const latest = window.allReelsData.reduce((a, b) => {
                const parse = d => {
                    // ✅ รองรับ format "DD/MM/YY" หรือ "D/M/YY"
                    const parts = d.Date.split('/').map(Number);
                    if (parts.length === 3) {
                        const [dd, mm, yy] = parts;
                        // แปลงปี 2 หลักเป็น 4 หลัก (เช่น 68 เป็น 2068 หรือ 1968)
                        const fullYear = (yy < 100) ? (yy > 50 ? 1900 + yy : 2000 + yy) : yy;
                        return new Date(fullYear, mm - 1, dd);
                    }
                    return new Date(0); // Invalid date
                };
                const dateA = parse(a);
                const dateB = parse(b);
                return dateA > dateB ? a : b;
            });

            // ✅ ใช้ parse function เดียวกัน
            const latestDateObj = (latest && latest.Date) ? parse(latest) : new Date();

            if (flatpickrInstance) {
                flatpickrInstance.setDate(latestDateObj, true);
            }
            populateWorkTable(latestDateObj, currentProjectSheetName);
        } else {
            populateWorkTable(new Date(), currentProjectSheetName);
        }
    }
}

// ====================================================================================
// MAIN DOMContentLoaded (รวมทุกอย่างไว้ที่นี่)
// ====================================================================================
document.addEventListener('DOMContentLoaded', () => {
    // --- Initial setup for login button ---
    setTimeout(setupLoginButton, 0); // Ensure login button is set up after DOM is ready

    // --- Admin switch handler ---
    const adminSwitch = document.getElementById('admin-switch');
    const userMenuEl = document.getElementById('user-menu');
    const adminMenuEl = document.getElementById('admin-menu');
    const sidebarEl  = document.querySelector('.sidebar');

    if (adminSwitch) {
        adminSwitch.addEventListener('change', function() {
          if (this.checked) {
            // — เมื่อเปิด Admin Mode —
            sidebarEl.classList.add('admin-mode');      // เพิ่มคลาสเปลี่ยนสีใน CSS
            userMenuEl.classList.add('hidden');
            adminMenuEl.classList.remove('hidden');
            document.querySelector('#admin-menu a[data-view="admin-dashboard"]').click();
          } else {
            // — เมื่อปิด Admin Mode —
            sidebarEl.classList.remove('admin-mode');   // คืนคลาสสีเดิม
            adminMenuEl.classList.add('hidden');
            userMenuEl.classList.remove('hidden');
            document.querySelector('#user-menu a[data-view="home"]').click();
          }
        });
    }

    // ====================================================================================
    //  GLOBAL EVENT LISTENER FOR VIEW SWITCHING (EVENT DELEGATION)
    //  This single listener handles all clicks on elements with `data-view`.
    // ====================================================================================
// ================= START: GLOBAL EVENT LISTENER FOR VIEW SWITCHING (REVISED) =================
// This single listener handles all clicks on elements with `data-view`.
document.body.addEventListener('click', (e) => {
    // Find the nearest ancestor element (or the element itself) that has a `data-view` attribute.
    const link = e.target.closest('[data-view]');

    // If no such element is found, do nothing.
    if (!link) return;

    e.preventDefault(); // Prevent default link behavior (like navigating to '#').
    const targetView = link.dataset.view;
    let userName = null; // Initialize userName

    // If the clicked link is inside the sidebar, handle the 'active' class.
    if (link.closest('.sidebar')) {
        document.querySelectorAll('.sidebar a[data-view]').forEach(a => a.classList.remove('active'));
        link.classList.add('active');
    }

    // --- จุดสำคัญ: ตรวจสอบ targetView เพื่อเรียกฟังก์ชันให้ถูกตัว ---
    // Switch logic to call the correct data-fetching function for each view

    if (targetView === 'leaves') {
        // สำหรับหน้า Leaves, ให้เรียกฟังก์ชันนี้โดยตรง
        if (typeof populateLeavesTable === 'function') {
            console.log("[JS DEBUG] Calling populateLeavesTable() for 'leaves' view.");
            populateLeavesTable();
        } else {
            console.warn("[JS WARNING] Function populateLeavesTable() is not defined.");
        }
    } else if (targetView === 'monthly-summary' || targetView === 'summary-detail') {
        // สำหรับหน้า Summary อื่นๆ ที่จัดการโดย summary_views.js
        
        // ดึงชื่อ user เฉพาะตอนที่จะไปหน้ารายละเอียด
        if (targetView === 'summary-detail') {
            const row = e.target.closest('tr[data-username]'); // หาจากแถวที่ถูกคลิก
            if (row) {
                userName = row.dataset.username;
                console.log(`[JS DEBUG] Extracted username for summary-detail: ${userName}`);
            }
        }

        if (window.loadSummaryView) {
            console.log(`[JS DEBUG] Calling window.loadSummaryView() for '${targetView}'.`);
            window.loadSummaryView(targetView, userName);
        } else {
            console.warn("[JS WARNING] window.loadSummaryView is not defined. Summary views might not initialize correctly.");
        }
    }
    // สามารถเพิ่ม else if สำหรับ view อื่นๆ ในอนาคตได้ที่นี่
    // เช่น else if (targetView === 'staffs') { populateStaffsTable(); }
    
    // เรียกฟังก์ชันสลับหน้าจอ (ให้แสดงผล view ที่ถูกต้อง) เป็นลำดับสุดท้าย
    window.switchView(targetView);
});
// ================== END: GLOBAL EVENT LISTENER FOR VIEW SWITCHING ==================

// --- ยืนยันว่ามีฟังก์ชันนี้อยู่ด้วย ---
document.addEventListener('DOMContentLoaded', () => {
    // ... (existing code) ...

    // --- Initialize Flatpickr for Leaves View (ONCE) ---
    const leavesDatePicker = document.getElementById('leaves-date-picker');
    if (leavesDatePicker) {
        flatpickr(leavesDatePicker, {
            dateFormat: "Y-m-d",
            defaultDate: "today",
            onChange: function(selectedDates, dateStr, instance) {
                if (selectedDates.length > 0) {
                    const selectedDate = selectedDates[0];
                    const year = selectedDate.getFullYear();
                    const month = selectedDate.getMonth() + 1;
                    // Call the function to fetch and display data
                    fetchAndPopulateLeaves(year, month);
                }
            },
        });
    }

    // ... (the rest of your DOMContentLoaded event listener) ...
});

async function populateLeavesTable() {
    // This function is now just for the initial data load.
    const initialDate = new Date();
    fetchAndPopulateLeaves(initialDate.getFullYear(), initialDate.getMonth() + 1);
}

// Helper function to fetch and populate leaves data
async function populateLeavesTable() {
    // This function is now just for the initial data load.
    fetchAndPopulateLeaves(new Date()); // Load today's data initially
}

// Helper function to fetch and populate leaves data
async function fetchAndPopulateLeaves(dateObject) {
    const tbody = document.getElementById('leaves-table-body');
    if (!tbody) {
        console.error("Leaves table body not found!");
        return;
    }

    // --- แสดงวันที่ปัจจุบันที่หัวตาราง ---
    const dateDisplay = document.getElementById('current-date-display');
    if (dateDisplay) {
        const dateStr = dateObject.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
        dateDisplay.textContent = `ภาพรวมประจำวันที่ ${dateStr}`;
    }
    // --- สิ้นสุดการแก้ไข ---
    
    tbody.innerHTML = `<tr><td colspan="12" class="text-center p-4">กำลังโหลดข้อมูล...</td></tr>`;

    try {
        // Pass year, month, and day to the API
        const year = dateObject.getFullYear();
        const month = dateObject.getMonth() + 1;
        const day = dateObject.getDate();

        const res = await window.pywebview.api.fetch_leaves_list(year, month, day);
        if (res.status === 'ok' && Array.isArray(res.payload)) {
            const data = res.payload;
            
            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="12" class="text-center p-4">ไม่พบข้อมูล</td></tr>`;
                return;
            }

            tbody.innerHTML = data.map(staff => `
                <tr class="hover:bg-gray-50" data-username="${staff.name}">
                    <td class="p-3 text-sm text-center">${staff.id}</td>
                    <td class="p-3 text-sm font-semibold">${staff.name}</td>
                    <td class="p-3 text-sm">${staff.projectName}</td>
                    <td class="p-3 text-sm text-center">${staff.sentToday} คลิป</td>
                    <td class="p-3 text-sm text-center font-bold ${staff.statusToday === 'ส่งครบ' ? 'text-green-600' : 'text-red-600'}">${staff.statusToday}</td>
                    <td class="p-3 text-sm text-center">
                        ${staff.platformFB ? '<span class="fb-badge">Facebook</span>' : ''}
                        ${staff.platformIG ? '<span class="ig-badge">Instagram</span>' : ''}
                    </td>
                    <td class="p-3 text-sm text-center">${staff.monthlyTarget.toLocaleString()} คลิป</td>
                    <td class="p-3 text-sm text-center">${staff.totalClipsMonth.toLocaleString()} คลิป</td>
                    <td class="p-3 text-sm text-center">${staff.remainingLeave}</td>
                    <td class="p-3 text-sm text-center">${staff.totalLeaveDays} วัน</td>
                    <td class="p-3 text-sm text-center">${staff.totalMissingDays} ครั้ง</td>
                    <td class="p-3 text-sm text-center">
                        <button class="summary-btn bg-gray-700 text-white text-xs font-bold py-1 px-3 rounded-full hover:bg-gray-900" data-view="summary-detail">ดูภาพรวม</button>
                    </td>
                </tr>
            `).join('');
            
        } else {
            tbody.innerHTML = `<tr><td colspan="12" class="text-center p-4 text-red-500">Error: ${res.message || 'Could not load data.'}</td></tr>`;
        }
    } catch (err) {
        console.error("Error calling fetch_leaves_list:", err);
        tbody.innerHTML = `<tr><td colspan="12" class="text-center p-4 text-red-500">เกิดข้อผิดพลาดในการเชื่อมต่อ</td></tr>`;
    }
}

    // —————————————————————————————————————————————————————————————
    // 5) ปุ่ม “Exit Admin” → ปิด Toggle และสลับกลับ User
    // —————————————————————————————————————————————————————————————
    const exitAdminBtn  = document.getElementById('exit-admin-btn'); // Ensure exitAdminBtn is defined
    if (exitAdminBtn) {
      exitAdminBtn.addEventListener('click', () => {
        adminSwitch.checked = false;                           // เอา toggle ออก
        adminSwitch.dispatchEvent(new Event('change'));        // เรียก change handler
      });
    }

    // —————————————————————————————————————————————————————————————
    // 7) Initialize Flatpickr for the date picker
    // —————————————————————————————————————————————————————————————
    const datePicker = document.getElementById('date-picker');
    if (datePicker) {
      flatpickrInstance = flatpickr(datePicker, { // Assign to global variable
        dateFormat: "d/m/Y", // Display format
        defaultDate: "today",
        onChange: function(selectedDates, dateStr, instance) {
          console.log("[JS DEBUG] Flatpickr onChange. Selected date:", selectedDates[0], "Date string:", dateStr);
          console.log("[JS DEBUG] Flatpickr onChange: window.currentProjectSheetName is:", window.currentProjectSheetName); // ✅ NEW LOG

          const dateToUse = selectedDates.length > 0 && selectedDates[0] instanceof Date && !isNaN(selectedDates[0])
                            ? selectedDates[0] : new Date();

          // ✅ ปรับเงื่อนไขให้กระชับขึ้น
          if (window.currentProjectSheetName) {
              populateWorkTable(dateToUse, window.currentProjectSheetName);
          } else {
              console.error("[JS ERROR] Flatpickr onChange: currentProjectSheetName is missing. Cannot update table.");
          }
        }
      });
      console.log("[JS DEBUG] Flatpickr initialized.");
    } else {
      console.warn("[JS WARNING] Date picker element not found.");
    }

    // ─── ส่วนที่ 1: bind search & change events (Staffs) ─────────────────────────────────────
    const staffsMenuLink = document.querySelector('#admin-menu a[data-view="staffs"]');
    const tableBody = document.getElementById('staff-table-body');
    const searchInput = document.getElementById('staff-search-input');

    if (staffsMenuLink && tableBody && searchInput) {
    staffsMenuLink.addEventListener('click', async () => {
      console.log("[JS DEBUG] เมนู Staffs ถูกคลิก");

      // ถ้า cache ว่าง ให้ fetch ครั้งเดียว
      if (!Array.isArray(window.allStaffsData) || window.allStaffsData.length === 0) {
        tableBody.innerHTML = `<div class="loading-state">กำลังโหลดข้อมูล...</div>`;
        try {
          const res = await window.pywebview.api.fetch_staffs_data(staffSheetUrl);
          console.log("[JS DEBUG] fetch_staffs_data result:", res);
          // Flexible payload extraction
          let staffsArr = Array.isArray(res.payload)
                          ? res.payload
                          : Array.isArray(res)
                            ? res
                            : [];
          window.allStaffsData = staffsArr;
        } catch (e) {
          console.error("[JS ERROR] fetch_staffs_data failed:", e);
          tableBody.innerHTML = `<div class="loading-state error">โหลดข้อมูลล้มเหลว</div>`;
          return;
        }
      }

      // แสดงข้อมูลจาก cache เสมอ
      populateStaffsTable(window.allStaffsData);
    });

        searchInput.addEventListener('input', () => {
            const searchTerm = searchInput.value.toLowerCase().trim();
            // ✅ ใช้ window.allStaffsData ที่ถูกเก็บไว้ใน global state
            const allData = window.allStaffsData || [];

            const filteredData = allData.filter(staff => {
                return (staff.Name?.toLowerCase().includes(searchTerm) ||
                        staff['E-Mail']?.toLowerCase().includes(searchTerm) ||
                        staff['Project Name']?.toLowerCase().includes(searchTerm));
            });

            populateStaffsTable(filteredData);
        });

        // --- จัดการ Event Click สำหรับปุ่ม Platform, Status และ Change สำหรับ Role ---
        tableBody.addEventListener('click', async (event) => {
            const staffRow = event.target.closest('.staff-data-row');
            if (!staffRow) return;

            const staffId = staffRow.dataset.staffId;
            const staffSheetUrl = 'https://docs.google.com/sheets/d/17lOtuHum9VHdukfHr7143uCGydVZSaJNi2RhzGfh81g/edit'; // Use the correct sheet URL

            // Logic สำหรับปุ่ม Platform
            const platformBtn = event.target.closest('.platform-btn');
            if (platformBtn) {
                const platform = platformBtn.dataset.platform; // 'IG' หรือ 'FB'
                const wasActive = platformBtn.classList.contains('active');
                const newIsActive = !wasActive; // สถานะใหม่
                const newValue = newIsActive ? '1' : '0';

                // Optimistic UI Update
                platformBtn.classList.toggle('active', newIsActive);

                try {
                    const result = await window.pywebview.api.update_staff_info(staffSheetUrl, staffId, platform, newValue);
                    if (result.status !== 'ok') {
                        console.error(`[JS ERROR] ไม่สามารถอัปเดต ${platform} ของ ${staffId}: ${result.message}`);
                        Swal.fire('Error', `ไม่สามารถอัปเดต ${platform} ได้: ${result.message}`, 'error');
                        // Revert UI on error
                        platformBtn.classList.toggle('active', wasActive);
                    }
                } catch (error) {
                    console.error(`[JS ERROR] เกิดข้อผิดพลาดในการเรียก API สำหรับ ${platform} ของ ${staffId}:`, error);
                    Swal.fire('Error', `เกิดข้อผิดพลาดในการอัปเดต ${platform}: ${error.message}`, 'error');
                    // Revert UI on API call failure
                    platformBtn.classList.toggle('active', wasActive);
                }
                return;
            }

            // Logic สำหรับปุ่ม Status
            const statusBtn = event.target.closest('.status-pill');
            if (statusBtn) {
                const currentStatusIsActive = statusBtn.classList.contains('active');
                const oldStatus = currentStatusIsActive ? 'Active' : 'Not active';
                const newStatus = currentStatusIsActive ? 'Not active' : 'Active';

                // Optimistic UI Update
                statusBtn.classList.toggle('active', !currentStatusIsActive);
                statusBtn.classList.toggle('inactive', currentStatusIsActive);
                statusBtn.querySelector('[data-field="status-text"]').textContent = newStatus;
                statusBtn.querySelector('[data-field="status-icon"]').className = newStatus === 'Active' ? 'fa-solid fa-check' : 'fa-solid fa-times';

                try {
                    const result = await window.pywebview.api.update_staff_info(staffSheetUrl, staffId, 'Status', newStatus);
                    if (result.status !== 'ok') {
                        console.error(`[JS ERROR] ไม่สามารถอัปเดตสถานะของ ${staffId}: ${result.message}`);
                        Swal.fire('Error', `ไม่สามารถอัปเดตสถานะได้: ${result.message}`, 'error');
                        // Revert UI on error
                        statusBtn.classList.toggle('active', currentStatusIsActive);
                        statusBtn.classList.toggle('inactive', !currentStatusIsActive);
                        statusBtn.querySelector('[data-field="status-text"]').textContent = oldStatus;
                        statusBtn.querySelector('[data-field="status-icon"]').className = oldStatus === 'Active' ? 'fa-solid fa-check' : 'fa-solid fa-times';
                    }
                } catch (error) {
                    console.error(`[JS ERROR] เกิดข้อผิดพลาดในการเรียก API สำหรับสถานะของ ${staffId}:`, error);
                    Swal.fire('Error', `เกิดข้อผิดพลาดในการอัปเดตสถานะ: ${error.message}`, 'error');
                    // Revert UI on API call failure
                    statusBtn.classList.toggle('active', currentStatusIsActive);
                    statusBtn.classList.toggle('inactive', !currentStatusIsActive);
                    statusBtn.querySelector('[data-field="status-text"]').textContent = oldStatus;
                    statusBtn.querySelector('[data-field="status-icon"]').className = oldStatus === 'Active' ? 'fa-solid fa-check' : 'fa-solid fa-times';
                }
                return;
            }

            // Logic for Role selector
            const roleSelector = event.target.closest('.role-selector');
            if (roleSelector) {
                console.warn("[JS WARNING] Role selector clicked, but should be handled by 'change' event.");
            }
        });

        // Add a separate 'change' listener for role selector
        tableBody.addEventListener('change', async (event) => {
            const roleSelector = event.target.closest('.role-selector');
            if (!roleSelector) return;

            const staffRow = roleSelector.closest('.staff-data-row');
            if (!staffRow) return;

            const staffId = staffRow.dataset.staffId;
            const newRole = roleSelector.value;
            const staffSheetUrl = 'https://docs.google.com/sheets/d/17lOtuHum9VHdukfHr7143uCGydVZSaJNi2RhzGfh81g/edit'; // Use the correct sheet URL

            console.log(`[JS DEBUG] Updating Role for Staff ID: ${staffId} to "${newRole}"`);

            try {
                const result = await window.pywebview.api.update_staff_info(staffSheetUrl, staffId, 'Role', newRole);
                if (result.status !== 'ok') {
                    console.error(`[JS ERROR] ไม่สามารถอัปเดตบทบาทของ ${staffId}: ${result.message}`);
                    Swal.fire('Error', `ไม่สามารถอัปเดตบทบาทได้: ${result.message}`, 'error');
                }
            } catch (error) {
                console.error(`[JS ERROR] เกิดข้อผิดพลาดในการเรียก API สำหรับบทบาทของ ${staffId}:`, error);
                Swal.fire('Error', `เกิดข้อผิดพลาดในการอัปเดตบทบาท: ${error.message}`, 'error');
            }
        });

        // Logic สำหรับ Editable Cells (Name, E-Mail)
        tableBody.addEventListener('blur', async (event) => {
            const editableCell = event.target.closest('.editable-cell');
            if (!editableCell) return;

            const staffRow = editableCell.closest('.staff-data-row');
            if (!staffRow) return;

            const staffId = staffRow.dataset.staffId;
            const field = editableCell.dataset.field; // 'name' หรือ 'email'
            const oldValue = editableCell.dataset.oldValue; // ค่าเดิมที่เก็บไว้
            const newValue = editableCell.textContent.trim();
            const staffSheetUrl = 'https://docs.google.com/sheets/d/17lOtuHum9VHdukfHr7143uCGydVZSaJNi2RhzGfh81g/edit'; // Use the correct sheet URL

            // ตรวจสอบว่ามีการเปลี่ยนแปลงหรือไม่
            if (newValue === oldValue) {
                return; // ไม่มีอะไรเปลี่ยนแปลง ไม่ต้องส่ง API
            }

            console.log(`[JS DEBUG] Updating ${field} for Staff ID: ${staffId} from "${oldValue}" to "${newValue}"`);

            // Optimistic UI Update: UI ได้เปลี่ยนไปแล้ว
            editableCell.dataset.oldValue = newValue; // อัปเดตค่าเดิมใน dataset

            try {
                // Map field to Google Sheet column name
                let columnName;
                if (field === 'name') {
                    columnName = 'Name';
                } else if (field === 'email') {
                    columnName = 'E-Mail';
                } else {
                    console.error(`[JS ERROR] Unknown editable field: ${field}`);
                    return;
                }

                const result = await window.pywebview.api.update_staff_info(staffSheetUrl, staffId, columnName, newValue);
                if (result.status !== 'ok') {
                    console.error(`[JS ERROR] ไม่สามารถอัปเดต ${columnName} ของ ${staffId}: ${result.message}`);
                    Swal.fire('Error', `ไม่สามารถอัปเดต ${columnName} ได้: ${result.message}`, 'error');
                    // Revert UI on error
                    editableCell.textContent = oldValue;
                    editableCell.dataset.oldValue = oldValue; // Revert stored old value
                }
            }
            catch (error) {
                console.error(`[JS ERROR] เกิดข้อผิดพลาดในการเรียก API สำหรับ ${field} ของ ${staffId}:`, error);
                Swal.fire('Error', `เกิดข้อผิดพลาดในการอัปเดต ${field}: ${error.message}`, 'error');
                // Revert UI on API call failure
                editableCell.textContent = oldValue;
                editableCell.dataset.oldValue = oldValue; // Revert stored old value
            }
        }, true); // Use capture phase to ensure blur fires before other clicks

        // Optional: Select all text on focus for editable cells
        tableBody.addEventListener('focus', (event) => {
            const editableCell = event.target.closest('.editable-cell');
            if (editableCell) {
                const range = document.createRange();
                range.selectNodeContents(editableCell);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }, true);
    } // End if staffsMenuLink, tableBody, searchInput

    // ─── ส่วนที่ 3: ฟังก์ชันสร้างตาราง Staffs ───────────────────────────────────
    /**
     * ฟังก์ชันหลักสำหรับสร้างและแสดงข้อมูลในตาราง Staffs (เวอร์ชัน 2025 UI/UX)
     * @param {Array<Object>} staffsData - อาร์เรย์ของข้อมูลพนักงาน
     */
    function populateStaffsTable(staffsData) {
        const tableBody = document.getElementById('staff-table-body'); // เปลี่ยนจาก staffs-table-body เป็น staff-table-body
        const template = document.getElementById('staff-row-template');

        if (!tableBody || !template) return;
        tableBody.innerHTML = '';

        if (!Array.isArray(staffsData) || staffsData.length === 0) {
            tableBody.innerHTML = `<div class="loading-state error">ไม่พบข้อมูลพนักงานที่ตรงกับเงื่อนไข</div>`;
            return;
        }

        const getVal = (obj, field) => {
            const key = Object.keys(obj).find(k => k.trim().toLowerCase() === field.toLowerCase());
            const value = key ? obj[key] : undefined;
            return typeof value === 'string' ? value.trim() : value;
        };

        staffsData.forEach((staff, index) => {
            const id      = getVal(staff, 'ID')            ?? index + 1;
            const name    = getVal(staff, 'Name')          || '-';
            const email   = getVal(staff, 'E-Mail')        || '-';
            const status  = getVal(staff, 'Status')        || 'Not active';
            const project = getVal(staff, 'Project Name')  || '-';
            const hasFB   = String(getVal(staff, 'FB') ?? '0').trim() === '1';
            const hasIG   = String(getVal(staff, 'IG') ?? '0').trim() === '1';
            const role    = getVal(staff, 'Role')          || 'User';

            const clone = template.content.cloneNode(true);
            const row = clone.querySelector('.staff-data-row');
            row.dataset.staffId = id;

            // เติมข้อมูล
            row.querySelector('[data-field="index"]').textContent = id;
            row.querySelector('[data-field="staff-id"]').textContent = getVal(staff, 'Staff ID') || '-';
            row.querySelector('[data-field="avatar"]').src = `https://i.pravatar.cc/32?u=${email}`;
            const nameCell = row.querySelector('[data-field="name"]');
            nameCell.textContent = name;
            nameCell.dataset.oldValue = name; // Store original value

            const emailCell = row.querySelector('[data-field="email"]');
            emailCell.textContent = email;
            emailCell.dataset.oldValue = email; // Store original value

            row.querySelector('[data-field="project"]').textContent = project;

            // Status Pill
            const statusPill = row.querySelector('[data-field="status-toggle"]');
            const statusIcon = statusPill.querySelector('[data-field="status-icon"]');
            const statusText = statusPill.querySelector('[data-field="status-text"]');

            // ✅ แก้ไขตรงนี้: ใช้การเปรียบเทียบแบบตรงตัวแทน includes
            const lowerCaseStatus = status.toLowerCase();
            console.log(`[JS DEBUG] Staff ID: ${id}, Raw Status from data: '${staff['Status']}', Processed Status (lowercase): '${lowerCaseStatus}'`); // เพิ่ม log

            if (lowerCaseStatus === 'active') {
                statusPill.classList.add('active');
                statusPill.classList.remove('inactive'); // ตรวจสอบให้แน่ใจว่าลบคลาส inactive ออก
                statusIcon.className = 'fa-solid fa-check';
                statusText.textContent = 'Active';
            } else if (lowerCaseStatus === 'not active') { // ตรวจสอบสถานะ "not active" โดยเฉพาะ
                statusPill.classList.add('inactive');
                statusPill.classList.remove('active'); // ตรวจสอบให้แน่ใจว่าลบคลาส active ออก
                statusIcon.className = 'fa-solid fa-times';
                statusText.textContent = 'Not active';
            } else {
                // กรณีสถานะอื่นๆ เช่น 'Out', 'Rest'
                statusPill.classList.remove('active', 'inactive'); // ลบคลาสทั้งคู่
                statusIcon.className = 'fa-solid fa-question'; // ไอคอนเริ่มต้น
                statusText.textContent = status; // แสดงข้อความสถานะจริง
            }

            // Platform Toggle Buttons
            const platformContainer = row.querySelector('[data-field="platforms"]');
            platformContainer.innerHTML = '';

            const fbBtn = document.createElement('button');
            fbBtn.className = 'platform-btn fb';
            fbBtn.dataset.platform = 'FB';
            fbBtn.textContent = 'FB';
            if (hasFB) fbBtn.classList.add('active');
            platformContainer.appendChild(fbBtn);

            const igBtn = document.createElement('button');
            igBtn.className = 'platform-btn ig';
            igBtn.dataset.platform = 'IG';
            igBtn.textContent = 'IG';
            if (hasIG) igBtn.classList.add('active');
            platformContainer.appendChild(igBtn);

            // Role Dropdown
            const roleSelect = row.querySelector('[data-field="role-select"]');
            if (roleSelect) { // ตรวจสอบว่า element มีอยู่จริง
                roleSelect.value = role;
            } else {
                console.warn("[JS WARNING] Role selector element not found for staff row.");
            }

            tableBody.appendChild(row);
        });
    }

    // --- Team Mini Tabs ---
    const tabButtons = document.querySelectorAll('.team-mini-tabs .tab-btn');
    const teamTabContents = document.querySelectorAll('.team-tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // --- Active state for buttons ---
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // --- Show/Hide content ---
            const targetTab = button.dataset.tab;
            teamTabContents.forEach(content => {
                content.classList.toggle('hidden-view', content.id !== `team-tab-${targetTab}`);
            });
        });
    });

    // --- Date/Time Display ---
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // ====================================================================================
    // START: NEW PROFILE MANAGEMENT LOGIC
    // ====================================================================================
    const profileView = document.getElementById('view-profile');
    if (profileView) { // Only run if the profile view is on the page

        // --- 1. Get references to all profile elements ---
        const nameElement = profileView.querySelector('.ppp-user-info .name');
        const roleElement = profileView.querySelector('.ppp-user-info .role');
        const emailInput = profileView.querySelector('#email');
        const firstNameInput = profileView.querySelector('#first-name');
        const lastNameInput = profileView.querySelector('#last-name');
        const saveChangesBtn = profileView.querySelector('.form-actions .btn-primary');
        const discardChangesBtn = profileView.querySelector('.form-actions .btn-secondary');
        const profileMenuLink = document.querySelector('a[data-view="profile"]');

        let originalProfileData = {};

        // --- 2. Function to populate the form ---
        const populateProfileForm = (profile) => {
            originalProfileData = profile; // Store the original data

            const name = profile.name || 'N/A';
            const role = profile.role || 'N/A';
            const email = profile.email || '';
            const nameParts = name.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            if (nameElement) nameElement.textContent = name;
            if (roleElement) roleElement.textContent = role;
            if (emailInput) emailInput.value = email;
            if (firstNameInput) firstNameInput.value = firstName;
            if (lastNameInput) lastNameInput.value = lastName;

            // Update profile page avatar
            const profilePageAvatar = document.getElementById('profile-page-avatar');
            if (profilePageAvatar) profilePageAvatar.src = profile.avatar_url || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=200&auto=format&fit=crop';

            // Update top-right user info in view-home
            const topRightUserName = document.getElementById('top-right-user-name');
            const topRightAvatar = document.getElementById('top-right-avatar');
            if (topRightUserName) topRightUserName.textContent = name;
            if (topRightAvatar) topRightAvatar.src = profile.avatar_url || 'https://i.pravatar.cc/50?img=1';

            // Update top-right user info in view-staffs
            const staffsTopUserName = document.getElementById('staffs-top-user-name');
            const staffsTopUserRole = document.getElementById('staffs-top-user-role');
            const staffsTopUserAvatar = document.getElementById('staffs-top-user-avatar');
            if (staffsTopUserName) staffsTopUserName.textContent = name;
            if (staffsTopUserRole) staffsTopUserRole.textContent = role;
            if (staffsTopUserAvatar) staffsTopUserAvatar.src = profile.avatar_url || 'https://i.pravatar.cc/40?img=2';
        };

        // --- 3. Function to fetch data from backend ---
        const loadProfileData = async () => {
            console.log("[JS PROFILE] Fetching profile data...");
            try {
                const res = await window.pywebview.api.get_profile_data();
                if (res.status === 'ok') {
                    console.log("[JS PROFILE] Data received:", res.payload);
                    window.profileData = res.payload; // <-- เซ็ต profileData ให้ window
                    populateProfileForm(res.payload);
                    // เรียก loadProject อีกครั้งหลัง profileData พร้อม
                    if (window.currentProjectId) {
                        loadProject(window.currentProjectId);
                    }
                } else {
                    Swal.fire('Error', `Could not load profile: ${res.message}`, 'error');
                    console.error("[JS PROFILE] API Error:", res.message);
                }
            } catch (err) {
                Swal.fire('Error', 'An unexpected error occurred while fetching the profile.', 'error');
                console.error("[JS PROFILE] Fetch Error:", err);
            }
        };

        // --- 4. Event listener for the main profile menu link ---
        if (profileMenuLink) {
            profileMenuLink.addEventListener('click', (e) => {
                e.preventDefault();
                loadProfileData();
            });
        }

        // --- 5. Event listener for changing avatar (NEW MODAL LOGIC) ---
        const openAvatarModalBtn = document.getElementById('open-avatar-modal-btn');
        const profilePicModal = document.getElementById('profile-pic-modal');
        const closeButton = profilePicModal ? profilePicModal.querySelector('.close-button') : null;
        const profilePicGrid = document.getElementById('profile-pic-grid');
        const selectedProfilePicInput = document.getElementById('selected-profile-pic');
        const saveProfilePicBtn = document.getElementById('save-profile-pic-btn');

        // Function to open the modal
        const openModal = () => {
            if (profilePicModal) {
                profilePicModal.style.display = 'flex';
                loadProfilePictures(); // Load images when modal opens
            }
        };

        // Function to close the modal
        const closeModal = () => {
            if (profilePicModal) {
                profilePicModal.style.display = 'none';
                // Clear selected state
                const currentlySelected = profilePicGrid.querySelector('.selected');
                if (currentlySelected) {
                    currentlySelected.classList.remove('selected');
                }
                selectedProfilePicInput.value = '';
            }
        };

        // Function to load profile pictures from the backend
        const loadProfilePictures = async () => {
            if (!profilePicGrid) return;
            profilePicGrid.innerHTML = '<div class="loading-state">กำลังโหลดรูปภาพ...</div>';
            try {
                const res = await window.pywebview.api.list_profile_pics();
                if (res.status === 'ok' && Array.isArray(res.payload)) {
                    profilePicGrid.innerHTML = ''; // Clear loading state
                    res.payload.forEach(picPath => {
                        const imgContainer = document.createElement('div');
                        imgContainer.classList.add('profile-pic-item');
                        const img = document.createElement('img');
                        img.src = picPath;
                        img.alt = 'Profile Picture';
                        img.dataset.path = picPath; // Store the full path

                        imgContainer.appendChild(img);
                        profilePicGrid.appendChild(imgContainer);

                        imgContainer.addEventListener('click', () => {
                            // Remove 'selected' from all others
                            profilePicGrid.querySelectorAll('.profile-pic-item').forEach(item => {
                                item.classList.remove('selected');
                            });
                            // Add 'selected' to the clicked one
                            imgContainer.classList.add('selected');
                            selectedProfilePicInput.value = picPath; // Store selected path
                        });
                    });
                } else {
                    profilePicGrid.innerHTML = '<div class="error-state">ไม่สามารถโหลดรูปภาพได้</div>';
                    console.error("[JS PROFILE] Failed to load profile pictures:", res.message);
                }
            } catch (err) {
                profilePicGrid.innerHTML = '<div class="error-state">เกิดข้อผิดพลาดในการโหลดรูปภาพ</div>';
                console.error("[JS PROFILE] Error fetching profile pictures:", err);
            }
        };

        // Event listeners for modal
        if (openAvatarModalBtn) {
            openAvatarModalBtn.addEventListener('click', openModal);
        }
        if (closeButton) {
            closeButton.addEventListener('click', closeModal);
        }
        if (profilePicModal) {
            profilePicModal.addEventListener('click', (e) => {
                if (e.target === profilePicModal) { // Clicked outside the modal content
                    closeModal();
                }
            });
        }

        // Event listener for saving selected profile picture
        if (saveProfilePicBtn) {
            saveProfilePicBtn.addEventListener('click', async () => {
                const selectedPath = selectedProfilePicInput.value;
                if (!selectedPath) {
                    Swal.fire('No Selection', 'กรุณาเลือกรูปโปรไฟล์', 'warning');
                    return;
                }

                // Show loading state
                saveProfilePicBtn.disabled = true;
                saveProfilePicBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังบันทึก...';

                try {
                    // Call the existing update_profile_avatar API with the selected path
                    const res = await window.pywebview.api.update_profile_avatar(selectedPath);
                    if (res.status === 'ok') {
                        Swal.fire('Success', 'รูปโปรไฟล์อัปเดตสำเร็จ!', 'success');
                        // Update all avatar displays
                        populateProfileForm({ ...originalProfileData, avatar_url: selectedPath });
                        closeModal();
                    } else {
                        Swal.fire('Update Failed', res.message, 'error');
                    }
                } catch (err) {
                    Swal.fire('Error', 'เกิดข้อผิดพลาดขณะอัปเดตรูปโปรไฟล์.', 'error');
                    console.error("[JS PROFILE] Avatar Update Error:", err);
                } finally {
                    saveProfilePicBtn.disabled = false;
                    saveProfilePicBtn.innerHTML = 'บันทึกรูปโปรไฟล์';
                }
            });
        }

        // --- 6. Event listener for the "Save Changes" button (existing) ---
        if (saveChangesBtn) {
            saveChangesBtn.addEventListener('click', async () => {
                const firstName = firstNameInput.value.trim();
                const lastName = lastNameInput.value.trim();
                const newFullName = `${firstName} ${lastName}`.trim();

                if (!newFullName) {
                    Swal.fire('Invalid Name', 'First Name and Last Name cannot be empty.', 'warning');
                    return;
                }

                // Check if the name has actually changed
                if (newFullName === originalProfileData.name) {
                    Swal.fire('No Changes', 'The name has not been changed.', 'info');
                    return;
                }

                // Show loading state
                saveChangesBtn.disabled = true;
                saveChangesBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

                try {
                    const res = await window.pywebview.api.update_profile_name(newFullName);
                    if (res.status === 'ok') {
                        Swal.fire('Success', 'Your name has been updated successfully!', 'success');
                        // Update the display with the new name
                        populateProfileForm({ ...originalProfileData, name: newFullName });
                    } else {
                        Swal.fire('Update Failed', res.message, 'error');
                    }
                } catch (err) {
                    Swal.fire('Error', 'An unexpected error occurred during the update.', 'error');
                    console.error("[JS PROFILE] Update Error:", err);
                } finally {
                    // Restore button state
                    saveChangesBtn.disabled = false;
                    saveChangesBtn.innerHTML = 'Save Changes';
                }
            });
        }

        // --- 7. Event listener for the "Discard Changes" button (existing) ---
        if (discardChangesBtn) {
            discardChangesBtn.addEventListener('click', () => {
                // Restore the form to the original state
                populateProfileForm(originalProfileData);
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'info',
                    title: 'Changes have been discarded',
                    showConfirmButton: false,
                    timer: 2000
                });
            });
        }

        // --- Load profile data immediately after login ---
        // This will be called by initApp after successful login
        window.loadProfileDataOnLogin = loadProfileData;
    } // End if profileView

    // =======================================
    // JavaScript สำหรับ Tab Switching Logic
    // =======================================
    const tabLinks = document.querySelectorAll('.ppp-nav-menu li a');
    const pppTabContents = document.querySelectorAll('.ppp-tab-content'); // Renamed to avoid conflict with teamTabContents

    // === Log Out Modal Elements ===
    const logoutLink = document.getElementById('logout-link');
    const logoutModalOverlay = document.getElementById('logout-modal-overlay');
    const confirmLogoutBtn = document.getElementById('confirm-logout-btn');
    const cancelLogoutBtn = document.getElementById('cancel-logout-btn');

    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            // If the clicked link is the Log Out link, show the modal instead of switching tabs
            if (link.id === 'logout-link') {
                if (logoutModalOverlay) {
                    logoutModalOverlay.classList.add('show');
                }
                return;
            }

            // --- Normal Tab Switching Logic (for other tabs) ---
            tabLinks.forEach(item => item.classList.remove('active'));
            pppTabContents.forEach(content => content.style.display = 'none'); // Use pppTabContents

            link.classList.add('active');

            const targetId = link.dataset.tabTarget;
            if (targetId) {
                document.getElementById(targetId).style.display = 'block';
            }
        });
    });

    // =======================================
    // JavaScript สำหรับ Change Password Form (Logic เดิม)
    // =======================================
    const togglePasswordButtons = document.querySelectorAll('.toggle-password');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const passwordStrengthBar = document.getElementById('password-strength-bar');
    const passwordStrengthText = document.getElementById('password-strength-text');
    const passwordRequirements = document.querySelectorAll('.password-requirements .requirement');
    const confirmPasswordMessage = document.getElementById('confirm-password-message');
    const updatePasswordBtn = document.getElementById('update-password-btn');
    const formStatusMessage = document.getElementById('form-status-message');

    // Function to Show/Hide Password
    togglePasswordButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetInputId = this.dataset.target;
            const passwordInput = document.getElementById(targetInputId);
            const icon = this;

            if (passwordInput.getAttribute('type') === 'password') {
                passwordInput.setAttribute('type', 'text');
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            } else {
                passwordInput.setAttribute('type', 'password');
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            }
        });
    });

    // Function to check password strength
    function checkPasswordStrength(password) {
        let score = 0;
        const requirements = {
            length: password.length >= 8,
            uppercase: /[A-Z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
        };

        passwordRequirements.forEach(reqElement => {
            const reqType = reqElement.dataset.requirement;
            if (requirements[reqType]) {
                reqElement.classList.add('valid');
                reqElement.querySelector('i').classList.remove('fa-circle-xmark');
                reqElement.querySelector('i').classList.add('fa-check');
            } else {
                reqElement.classList.remove('valid');
                reqElement.querySelector('i').classList.remove('fa-check');
                reqElement.querySelector('i').classList.add('fa-circle-xmark');
            }
        });

        if (requirements.length) score++;
        if (requirements.uppercase) score++;
        if (requirements.number) score++;
        if (requirements.special) score++;

        let strengthText = '';
        let barWidth = 0;
        let barColor = '';

        if (password.length === 0) {
            strengthText = '';
            barWidth = 0;
            barColor = '#E5E7EB';
        } else if (score === 0) {
            strengthText = 'รหัสของคุณอ่อนแอมาก';
            barWidth = 0;
            barColor = '#dc3545';
        } else if (score === 1) {
            strengthText = 'อ่อนแอ';
            barWidth = 25;
            barColor = '#ffc107';
        } else if (score === 2) {
            strengthText = 'ปานกลาง';
            barWidth = 50;
            barColor = '#fd7e14';
        } else if (score === 3) {
            strengthText = 'ดี';
            barWidth = 75;
            barColor = '#20c997';
        } else if (score === 4) {
            strengthText = 'แข็งแรงมาก';
            barWidth = 100;
            barColor = '#28a745';
        }

        passwordStrengthBar.style.width = barWidth + '%';
        passwordStrengthBar.style.backgroundColor = barColor;
        passwordStrengthText.textContent = strengthText;
        passwordStrengthText.style.color = barColor;
    }

    function checkPasswordsMatch() {
        const newPass = newPasswordInput.value;
        const confirmPass = confirmPasswordInput.value;

        if (confirmPass.length === 0) {
            confirmPasswordMessage.style.display = 'none';
        } else if (newPass === confirmPass) {
            confirmPasswordMessage.style.display = 'block';
            confirmPasswordMessage.textContent = 'รหัสผ่านตรงกัน!';
            confirmPasswordMessage.classList.remove('error');
            confirmPasswordMessage.classList.add('valid');
        } else {
            confirmPasswordMessage.style.display = 'block';
            confirmPasswordMessage.textContent = 'รหัสผ่านไม่ตรงกัน.';
            confirmPasswordMessage.classList.remove('valid');
            confirmPasswordMessage.classList.add('error');
        }
    }

    function showFormStatus(message, type) {
        let iconHtml = '';
        if (type === 'success') {
            iconHtml = '<i class="fas fa-check-circle"></i> ';
        } else if (type === 'error') {
            iconHtml = '<i class="fas fa-times-circle"></i> ';
        }
        formStatusMessage.innerHTML = iconHtml + message;
        formStatusMessage.className = 'form-status-message show';
        formStatusMessage.classList.add(type);
        formStatusMessage.style.display = 'flex';

        setTimeout(() => {
            formStatusMessage.classList.remove('show');
            formStatusMessage.style.display = 'none';
        }, 3000);
    }

    newPasswordInput.addEventListener('input', () => {
        checkPasswordStrength(newPasswordInput.value);
        checkPasswordsMatch();
    });

    confirmPasswordInput.addEventListener('input', checkPasswordsMatch);

    updatePasswordBtn.addEventListener('click', (e) => {
        e.preventDefault();

        formStatusMessage.classList.remove('show', 'success', 'error');
        formStatusMessage.style.display = 'none';

        updatePasswordBtn.disabled = true;
        updatePasswordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังอัปเดต...';

        setTimeout(() => {
            const oldPassword = document.getElementById('old-password').value;
            const newPassword = newPasswordInput.value;
            const confirmPassword = confirmPasswordInput.value;

            let hasError = false;
            if (oldPassword === '') {
                showFormStatus('กรุณากรอกรหัสผ่านปัจจุบัน.', 'error');
                hasError = true;
            } else if (newPassword === '') {
                showFormStatus('กรุณากรอกรหัสผ่านใหม่.', 'error');
                hasError = true;
            } else if (newPassword === oldPassword) {
                showFormStatus('รหัสผ่านใหม่ต้องไม่เหมือนรหัสผ่านเก่า!', 'error');
                hasError = true;
            } else if (newPassword !== confirmPassword) {
                showFormStatus('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน!', 'error');
                hasError = true;
            } else if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
                showFormStatus('รหัสผ่านใหม่ไม่ตรงตามข้อกำหนดความแข็งแรง!', 'error');
                hasError = true;
            }

            if (!hasError) {
                showFormStatus('อัปเดตรหัสผ่านสำเร็จ!', 'success');
                document.getElementById('old-password').value = '';
                newPasswordInput.value = '';
                confirmPasswordInput.value = '';
                checkPasswordStrength('');
                confirmPasswordMessage.style.display = 'none';
            }

            updatePasswordBtn.disabled = false;
            updatePasswordBtn.innerHTML = 'Update Password';

        }, 1500);
    });

    checkPasswordStrength(newPasswordInput.value);

    // Event Listener for "เข้าสู่ระบบอีกครั้ง" button on Log Out content
    const logInAgainBtn = document.querySelector('.log-in-again-btn');
    if (logInAgainBtn) {
        logInAgainBtn.addEventListener('click', () => {
            // Hide the log-out-content tab
            const logOutContentTab = document.getElementById('log-out-content');
            if (logOutContentTab) {
                logOutContentTab.style.display = 'none';
            }
            // Show the login modal
            showLoginModal();
        });
    }

    // =======================================
    // JavaScript สำหรับ Log Out Confirmation Pop-up
    // =======================================
    if (logoutLink && logoutModalOverlay && confirmLogoutBtn && cancelLogoutBtn) {

        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();
            logoutModalOverlay.classList.add('show');
        });

        confirmLogoutBtn.addEventListener('click', async () => {
            logoutModalOverlay.classList.remove('show');
            try {
                const res = await window.pywebview.api.logout();
                if (res.status === 'ok') {
                    // Clear global state
                    currentUser = null;
                    projectMap = {};
                    currentProjectId = null;
                    currentProjectSheetName = '';
                    allPagesData = [];
                    allTransactionsData = [];
                    allReelsData = [];
                    allStaffsData = [];

                    // Hide the main app container
                    document.getElementById('app-container').style.display = 'none';

                    // Show the log-out-content tab (custom UI)
                    const logOutContentTab = document.getElementById('log-out-content');
                    if (logOutContentTab) {
                        logOutContentTab.style.display = 'flex';
                    } else {
                        // fallback: show login modal if log-out-content not found
                        showLoginModal();
                    }
                } else {
                    Swal.fire('Logout Failed', res.message || 'เกิดข้อผิดพลาดในการออกจากระบบ', 'error');
                    console.error("[JS ERROR] Logout API error:", res.message);
                }
            } catch (err) {
                Swal.fire('Logout Error', 'เกิดข้อผิดพลาดที่ไม่คาดคิดขณะออกจากระบบ.', 'error');
                console.error("[JS ERROR] Logout fetch error:", err);
            }
        });

        cancelLogoutBtn.addEventListener('click', () => {
            logoutModalOverlay.classList.remove('show');
        });

        logoutModalOverlay.addEventListener('click', (e) => {
            if (e.target === logoutModalOverlay) {
                logoutModalOverlay.classList.remove('show');
            }
        });
    }

    // =======================================
    // JavaScript สำหรับ Privacy Settings
    // =======================================
    const savePrivacySettingsBtn = document.getElementById('save-privacy-settings-btn');
    const privacyStatusMessage = document.getElementById('privacy-status-message');

    if (savePrivacySettingsBtn && privacyStatusMessage) {
        savePrivacySettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();

            privacyStatusMessage.classList.remove('show', 'success', 'error');
            privacyStatusMessage.style.display = 'none';

            savePrivacySettingsBtn.disabled = true;
            savePrivacySettingsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังบันทึก...';

            setTimeout(() => {
                const dataSharing = document.getElementById('data-sharing-toggle').checked;
                const directMarketing = document.getElementById('direct-marketing-toggle').checked;
                const usageHistory = document.getElementById('usage-history-toggle').checked;

                console.log('Privacy Settings Saved:', {
                    dataSharing,
                    directMarketing,
                    usageHistory
                });

                showFormStatusForPrivacy('บันทึกการตั้งค่าความเป็นส่วนตัวสำเร็จ!', 'success');

                savePrivacySettingsBtn.disabled = false;
                savePrivacySettingsBtn.innerHTML = 'บันทึกการเปลี่ยนแปลง';

            }, 1500);
        });
    }

    function showFormStatusForPrivacy(message, type) {
        let iconHtml = '';
        if (type === 'success') {
            iconHtml = '<i class="fas fa-check-circle"></i> ';
        } else if (type === 'error') {
            iconHtml = '<i class="fas fa-times-circle"></i> ';
        }
        privacyStatusMessage.innerHTML = iconHtml + message;
        privacyStatusMessage.className = 'form-status-message show';
        privacyStatusMessage.classList.add(type);
        privacyStatusMessage.style.display = 'flex';

        setTimeout(() => {
            privacyStatusMessage.classList.remove('show');
            privacyStatusMessage.style.display = 'none';
        }, 3000);
    }
});
