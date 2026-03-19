const grid = document.getElementById('parking-grid');
const modal = document.getElementById('booking-modal');
const closeModalBtn = document.getElementById('close-modal');
const bookingForm = document.getElementById('booking-form');
const checkoutInfo = document.getElementById('checkout-info');
const checkoutBtn = document.getElementById('checkout-btn');
const toast = document.getElementById('toast');

// Auth elements
const authModal = document.getElementById('auth-modal');
const authForm = document.getElementById('auth-form');
const toggleAuthBtn = document.getElementById('toggle-auth');
const roleGroup = document.getElementById('role-group');
const authTitle = document.getElementById('auth-title');
const authSubmit = document.getElementById('auth-submit');
const authToggleText = document.getElementById('auth-toggle-text');
const logoutBtn = document.getElementById('logout-btn');

let currentSlots = [];
let fetchInterval;
let currentUser = null;
let isSignupMode = false;

// Authenticate on load
async function checkAuth() {
    try {
        const response = await fetch('/api/me');
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            authModal.classList.add('hidden');
            updateUserUI();
            startApp();
        } else {
            authModal.classList.remove('hidden');
        }
    } catch(err) {
        authModal.classList.remove('hidden');
    }
}

function updateUserUI() {
    document.getElementById('current-username').textContent = currentUser.username;
    const roleBadge = document.getElementById('current-role');
    roleBadge.textContent = currentUser.role.toUpperCase();
    if (currentUser.role === 'admin') {
        roleBadge.classList.add('admin-badge');
        document.getElementById('nav-bookings').innerHTML = '<i class="fa-solid fa-car"></i> All Bookings';
        document.getElementById('bookings-title').textContent = 'All System Bookings';
    } else {
        roleBadge.classList.remove('admin-badge');
        document.getElementById('nav-bookings').innerHTML = '<i class="fa-solid fa-car"></i> My Bookings';
        document.getElementById('bookings-title').textContent = 'My Bookings';
    }
    document.getElementById('user-avatar').src = `https://ui-avatars.com/api/?name=${currentUser.username}&background=${currentUser.role === 'admin' ? 'ef4444' : '2563eb'}&color=fff`;
}

// Toggle Login / Signup
toggleAuthBtn.addEventListener('click', (e) => {
    e.preventDefault();
    isSignupMode = !isSignupMode;
    if (isSignupMode) {
        authTitle.textContent = 'Create Account';
        authSubmit.textContent = 'Sign Up';
        authToggleText.textContent = 'Already have an account?';
        toggleAuthBtn.textContent = 'Log in';
        roleGroup.classList.remove('hidden');
    } else {
        authTitle.textContent = 'Log In';
        authSubmit.textContent = 'Login';
        authToggleText.textContent = "Don't have an account?";
        toggleAuthBtn.textContent = 'Sign up';
        roleGroup.classList.add('hidden');
    }
});

// Auth form submission
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;
    const role = document.getElementById('auth-role').value;
    
    const endpoint = isSignupMode ? '/api/signup' : '/api/login';
    const body = isSignupMode ? {username, password, role} : {username, password};
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            currentUser = data.user;
            authModal.classList.add('hidden');
            updateUserUI();
            startApp();
            showToast('Authentication successful!');
            authForm.reset();
        } else {
            showToast(data.error || 'Authentication failed', true);
        }
    } catch (err) {
        showToast('Error connecting to server', true);
    }
});

logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    clearInterval(fetchInterval);
    currentUser = null;
    authModal.classList.remove('hidden');
    // Hide dashboard views and reset them to Dashboard
    document.querySelectorAll('.view-section').forEach(view => view.classList.add('hidden'));
    document.getElementById('dashboard-view').classList.remove('hidden');
    document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
    document.querySelector('.nav-links li[data-view="dashboard-view"]').classList.add('active');
    document.getElementById('page-title').textContent = 'Live Availability';
});

// App Flow
function startApp() {
    fetchSlots();
    if(fetchInterval) clearInterval(fetchInterval);
    fetchInterval = setInterval(fetchSlots, 2000);
}

async function fetchSlots() {
    if(!currentUser) return;
    try {
        const response = await fetch('/api/slots');
        const slots = await response.json();
        currentSlots = slots;
        renderGrid();
        updateStats();
        
        // Also refresh bookings if we are on bookings-view
        if(document.getElementById('bookings-view').classList.contains('hidden') === false) {
            loadBookings();
        }
        if(document.getElementById('payments-view').classList.contains('hidden') === false) {
            loadPayments();
        }
        if(document.getElementById('analytics-view').classList.contains('hidden') === false) {
            loadAnalytics();
        }
    } catch (err) {
        // silently fail
    }
}

function renderGrid() {
    grid.innerHTML = '';
    currentSlots.forEach(slot => {
        const slotEl = document.createElement('div');
        slotEl.className = `slot ${slot.is_available ? 'available' : 'occupied'}`;
        slotEl.innerHTML = `
            <div class="slot-number">${slot.slot_number}</div>
            <i class="fa-solid fa-car slot-icon"></i>
        `;
        
        slotEl.addEventListener('click', () => openModal(slot));
        grid.appendChild(slotEl);
    });
}

function updateStats() {
    const avail = currentSlots.filter(s => s.is_available).length;
    const occ = currentSlots.length - avail;
    document.getElementById('available-count').textContent = avail;
    document.getElementById('occupied-count').textContent = occ;
}

function openModal(slot) {
    document.getElementById('modal-slot-number').textContent = slot.slot_number;
    document.getElementById('slot-id-input').value = slot.id;
    
    if (slot.is_available) {
        bookingForm.classList.remove('hidden');
        checkoutInfo.classList.add('hidden');
        document.getElementById('modal-price').textContent = `₹${slot.price_per_hour.toFixed(2)}/hr`;
    } else {
        bookingForm.classList.add('hidden');
        checkoutInfo.classList.remove('hidden');
    }
    
    modal.classList.remove('hidden');
}

closeModalBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    bookingForm.reset();
});

modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.classList.add('hidden');
        bookingForm.reset();
    }
});

bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slotId = document.getElementById('slot-id-input').value;
    const vehicleNumber = document.getElementById('vehicle-number').value;
    
    try {
        const response = await fetch('/api/book', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                slot_id: parseInt(slotId),
                vehicle_number: vehicleNumber
            })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            showToast('Slot booked successfully!');
            modal.classList.add('hidden');
            bookingForm.reset();
            fetchSlots();
        } else {
            showToast(data.error || 'Failed to book slot', true);
        }
    } catch (err) {
        showToast('Error booking slot', true);
    }
});

checkoutBtn.addEventListener('click', async () => {
    const slotId = document.getElementById('slot-id-input').value;
    
    try {
        const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ slot_id: parseInt(slotId) })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            showToast(`Checkout successful! Total: ₹${data.amount_paid.toFixed(2)}`);
            modal.classList.add('hidden');
            fetchSlots();
        } else {
            showToast(data.error || 'Checkout failed', true);
        }
    } catch (err) {
        showToast('Error during checkout', true);
    }
});

async function loadBookings() {
    try {
        const response = await fetch('/api/my_bookings');
        const bookings = await response.json();
        const list = document.getElementById('bookings-list');
        list.innerHTML = '';
        
        if (bookings.error) return;
        if (bookings.length === 0) {
            list.innerHTML = `<p style="color: var(--text-secondary);">No active bookings.</p>`;
            return;
        }
        
        bookings.forEach(b => {
            const date = new Date(b.start_time).toLocaleString();
            list.innerHTML += `
                <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--glass-border); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="margin-bottom: 0.5rem; font-size: 1.125rem;">
                            <strong>Slot: ${b.slot_number}</strong>
                            <span class="role-badge" style="margin-left:1rem; ${b.status === 'active' ? 'background: var(--danger)' : 'background: var(--success)'}">${b.status.toUpperCase()}</span>
                        </div>
                        <p style="color: var(--text-secondary); font-size: 0.875rem;">Vehicle: ${b.vehicle_number} &bull; User: ${b.user_name} &bull; Date: ${date}</p>
                    </div>
                    ${b.amount_paid ? `<div style="font-weight:600; color:var(--success); font-size: 1.25rem;">₹${b.amount_paid.toFixed(2)}</div>` : ''}
                </div>
            `;
        });
    } catch (err) { }
}

function showToast(message, isError = false) {
    toast.textContent = message;
    toast.className = `toast ${isError ? 'error' : ''}`;
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, 4000);
}

// Sidebar Navigation
const navLinks = document.querySelectorAll('.nav-links li[data-view]');
const views = document.querySelectorAll('.view-section');
const pageTitle = document.getElementById('page-title');

navLinks.forEach(link => {
    link.addEventListener('click', () => {
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        views.forEach(view => view.classList.add('hidden'));
        const targetViewId = link.getAttribute('data-view');
        const targetView = document.getElementById(targetViewId);
        if(targetView) targetView.classList.remove('hidden');
        
        if (pageTitle) {
            if (targetViewId === 'dashboard-view') pageTitle.textContent = 'Live Availability';
            else if (targetViewId === 'bookings-view') {
                pageTitle.textContent = currentUser.role === 'admin' ? 'All Bookings' : 'My Bookings';
                loadBookings();
            }
            else if (targetViewId === 'payments-view') {
                pageTitle.textContent = 'Payments History';
                loadPayments();
            }
            else if (targetViewId === 'analytics-view') {
                pageTitle.textContent = currentUser.role === 'admin' ? 'System Analytics' : 'My Analytics';
                document.getElementById('analytics-title').textContent = currentUser.role === 'admin' ? 'System Analytics' : 'My Analytics';
                loadAnalytics();
            }
        }
    });
});

async function loadAnalytics() {
    try {
        const response = await fetch('/api/analytics');
        const data = await response.json();
        if (data.error) return;
        
        document.getElementById('analytics-revenue').textContent = `₹${data.total_revenue.toFixed(2)}`;
        document.getElementById('analytics-total-bookings').textContent = data.total_bookings;
        document.getElementById('analytics-active-bookings').textContent = data.active_bookings;
        
        const slotsContainer = document.getElementById('analytics-top-slots');
        slotsContainer.innerHTML = '';
        
        if (data.top_slots.length === 0) {
            slotsContainer.innerHTML = '<p style="color: var(--text-secondary);">No revenue data available yet.</p>';
        } else {
            data.top_slots.forEach((slot, index) => {
                slotsContainer.innerHTML += `
                    <div class="glass-panel" style="padding: 1.5rem; flex: 1; min-width: 150px; text-align: center;">
                        <div style="font-size: 2rem; color: var(--accent); margin-bottom: 0.5rem; font-weight: 700;">#${index+1}</div>
                        <h4 style="margin-bottom: 0.5rem;">Slot ${slot.slot_number}</h4>
                        <div style="color: var(--success); font-weight: 700; font-size: 1.25rem;">₹${slot.total.toFixed(2)}</div>
                    </div>
                `;
            });
        }
    } catch (err) {}
}

async function loadPayments() {
    try {
        const response = await fetch('/api/my_bookings');
        const bookings = await response.json();
        const list = document.getElementById('payments-list');
        if (!list) return;
        list.innerHTML = '';
        
        if (bookings.error) return;
        
        const payments = bookings.filter(b => b.status === 'completed' && b.amount_paid > 0);
        
        if (payments.length === 0) {
            list.innerHTML = `<p style="color: var(--text-secondary);">No transactions available.</p>`;
            return;
        }
        
        payments.forEach(p => {
            const date = new Date(p.end_time).toLocaleString();
            list.innerHTML += `
                <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--glass-border); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="margin-bottom: 0.5rem; font-size: 1.125rem;">
                            <strong>Payment for Slot: ${p.slot_number}</strong>
                        </div>
                        <p style="color: var(--text-secondary); font-size: 0.875rem;">Vehicle: ${p.vehicle_number} &bull; User: ${p.user_name} &bull; Date: ${date}</p>
                    </div>
                    <div style="font-weight:700; color:var(--success); font-size: 1.5rem;">₹${p.amount_paid.toFixed(2)}</div>
                </div>
            `;
        });
    } catch (err) { }
}

checkAuth();
