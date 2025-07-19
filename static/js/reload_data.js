// reload_data.js
/**
 * @file reload_data.js
 * @description Handles the global data reload button functionality.
 */

/**
 * Initializes the reload button with specific actions for clearing cache and completing the refresh.
 * @param {object} options - The options for initialization.
 * @param {() => Promise<void>} options.clearCaches - Async function to call for clearing all caches.
 * @param {() => Promise<void>} [options.onComplete] - Optional async function to run after caches are cleared.
 */
export function initReloadButton({ clearCaches, onComplete }) {
    const reloadBtn = document.getElementById('btn-reload');
    const spinner = document.getElementById('reload-spinner');

    if (!reloadBtn) {
        console.warn('Reload button (#btn-reload) not found.');
        return;
    }

    reloadBtn.addEventListener('click', async () => {
        if (reloadBtn.disabled) return;

        console.log('Reload button clicked.');
        reloadBtn.disabled = true;
        spinner.classList.remove('hidden');

        try {
            console.log('Clearing caches...');
            await clearCaches();
            console.log('Caches cleared.');

            // --- IMPROVED LOGIC: Check current view --- 
            const statsView = document.getElementById('view-stats');
            const isStatsViewVisible = statsView && !statsView.classList.contains('hidden-view');

            if (isStatsViewVisible && typeof onComplete === 'function') {
                console.log('Stats view is visible. Running onComplete callback...');
                await onComplete();
                console.log('onComplete callback finished.');
            } else {
                console.log('Not on Stats view or onComplete is not a function. Showing generic success message.');
                // Use SweetAlert for a better user experience
                if (window.Swal) {
                    window.Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: 'รีเฟรชข้อมูลสำเร็จ!',
                        showConfirmButton: false,
                        timer: 2000,
                        timerProgressBar: true
                    });
                }
            }

        } catch (error) {
            console.error('An error occurred during the reload process:', error);
            if (window.Swal) {
                window.Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'error',
                    title: 'เกิดข้อผิดพลาด!',
                    text: error.message,
                    showConfirmButton: false,
                    timer: 3000
                });
            }
        } finally {
            spinner.classList.add('hidden');
            reloadBtn.disabled = false;
            console.log('Reload process finished.');
        }
    });
}

