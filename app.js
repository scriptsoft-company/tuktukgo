// 1. Database & State (IndexedDB with Dexie.js)
const db = new Dexie("TuktukDB");

db.version(1).stores({
    trips: 'id, date, archived',
    expenses: 'id, date, archived',
    dayEndLogs: 'date'
});

db.version(2).stores({
    trips: 'id, date, archived',
    expenses: 'id, date, archived',
    dayEndLogs: 'date',
    fuelLogs: 'id, date',
    settings: 'id'
});

db.version(3).stores({
    trips: 'id, date, archived',
    expenses: 'id, date, archived',
    dayEndLogs: 'id, date',
    fuelLogs: 'id, date',
    settings: 'id'
});

// --- 1.1 Supabase Configuration ---
let supabaseClient;
const SUPABASE_URL = 'https://lurloistqrpikhzypsif.supabase.co'; // Fixed URL
const SUPABASE_KEY = 'sb_publishable_UN4cvInjwm1ztYr67WE56g_2lcrr5EW';

try {
    if (typeof window.supabase !== 'undefined' && !supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        console.log("✅ Supabase Database Initialized");
    } else if (typeof window.supabase === 'undefined') {
        console.error("❌ Supabase library not loaded!");
    }
} catch (e) {
    console.error("❌ Supabase Initialization Failed:", e.message);
    alert("Supabase Error: " + e.message);
}

let savedUser = JSON.parse(localStorage.getItem('tuk_user')) || null;
if (savedUser && savedUser.id && !savedUser.id.includes('-')) {
    // Old Firebase user detected, clear it
    savedUser = null;
    localStorage.removeItem('tuk_user');
}

let state = {
    trips: [],
    expenses: [],
    dayEndLogs: [],
    fuelLogs: [],
    user: savedUser,
    gsheetUrl: localStorage.getItem('gsheet_url') || '',
    settings: {
        odometer: 0,
        lastService: 0,
        serviceInterval: 2500,
        voiceFeedback: true,
        sinhalaVoice: true,
        vehicleMode: 'tuk',
        pricing: {
            tuk: { firstKm: 100, nextKm: 90 },
            bike: { firstKm: 60, nextKm: 50 }
        }
    }
};

const getPricing = () => state.settings.pricing[state.settings.vehicleMode];

// Migration logic from LocalStorage to IndexedDB
async function migrateAndLoad() {
    try {
        const oldTrips = JSON.parse(localStorage.getItem('tuktuk_trips')) || [];
        const oldExpenses = JSON.parse(localStorage.getItem('tuktuk_expenses')) || [];
        const oldLogs = JSON.parse(localStorage.getItem('tuktuk_dayend_logs')) || [];

        if (oldTrips.length) { await db.trips.bulkPut(oldTrips); localStorage.removeItem('tuktuk_trips'); }
        if (oldExpenses.length) { await db.expenses.bulkPut(oldExpenses); localStorage.removeItem('tuktuk_expenses'); }
        if (oldLogs.length) { await db.dayEndLogs.bulkPut(oldLogs); localStorage.removeItem('tuktuk_dayend_logs'); }

        state.trips = await db.trips.orderBy('date').reverse().toArray();
        state.expenses = await db.expenses.orderBy('date').reverse().toArray();
        state.dayEndLogs = await db.dayEndLogs.orderBy('date').reverse().toArray();
        state.fuelLogs = await db.fuelLogs.orderBy('date').reverse().toArray();

        const savedSettings = await db.settings.get(1);
        if (savedSettings) {
            // merge with defaults to ensure new properties like 'pricing' are present
            for (var key in savedSettings) {
                state.settings[key] = savedSettings[key];
            }
            // Ensure nested objects are also merged if they exist
            if (savedSettings.pricing) {
                for (var pKey in savedSettings.pricing) {
                    state.settings.pricing[pKey] = savedSettings.pricing[pKey];
                }
            }
        }

        updateUI();
        updateVehicleUI();
        renderFuelLogs();
        updateHeader(); // Ensure header reflects mode on load
        updateVehicleModeUI();
    } catch (e) {
        console.error("Database error:", e);
    }
}

migrateAndLoad();

// Meter State
let meter = {
    active: false,
    distance: 0,
    fare: 0,
    startTime: null,
    watchId: null,
    lastPos: null,
    timerId: null,
    path: [], // Store [lat, lng] pairs
    map: null,
    trackLayer: null,
    marker: null
};

// Pricing Config
const PRICING = {
    firstKm: 100,
    nextKm: 90
};

// 2. Dynamic Header
function updateHeader() {
    const hour = new Date().getHours();
    const welcome = getEl('welcome-text');
    if (welcome) {
        if (hour < 12) welcome.textContent = "Good Morning,";
        else if (hour < 18) welcome.textContent = "Good Afternoon,";
        else welcome.textContent = "Good Evening,";
    }

    const avatar = getEl('user-avatar');
    if (avatar) {
        avatar.textContent = (state.settings && state.settings.vehicleMode === 'tuk') ? '🛺' : '🏍️';
    }
}

// 3. DOM Elements with Null Checks
const getEl = (id) => document.getElementById(id);

const elements = {
    pages: document.querySelectorAll('.page'),
    navItems: document.querySelectorAll('.nav-item'),
    tripForm: getEl('trip-form'),
    tripModal: getEl('trip-modal'),
    expenseModal: getEl('expense-modal'),
    expenseForm: getEl('expense-form'),
    meterScreen: getEl('meter-screen'),
    dayEndModal: getEl('day-end-modal'),
    addTripBtn: getEl('add-trip-btn'),
    startMeterBtn: getEl('start-meter-btn'),
    sliderThumb: getEl('slider-thumb'),
    sliderTrack: getEl('slider-track'),
    closeMeterBtn: getEl('close-meter'),
    addExpenseBtn: getEl('add-expense-btn'),
    dayEndBtn: getEl('day-end-btn'),
    closeModalBtns: document.querySelectorAll('.close-modal'),
    closeExpenseModalBtn: document.querySelector('.close-expense-modal'),
    closeDayModalBtn: document.querySelector('.close-day-modal'),
    recentTripsList: getEl('recent-trips-list'),
    fullHistoryList: getEl('full-history-list'),
    expenseList: getEl('expense-list'),
    logsContainer: getEl('logs-container'),
    syncSqlBtn: getEl('sync-sql-btn'),
    // New Vehicle/Settings Elements
    fuelModal: getEl('fuel-modal'),
    fuelForm: getEl('fuel-form'),
    fuelList: getEl('fuel-list'),
    odoInput: getEl('odo-input'),
    updateOdoBtn: getEl('update-odo-btn'),
    voiceToggle: getEl('voice-toggle'),
    voiceLang: getEl('voice-lang'),
    whatsappBtn: getEl('whatsapp-btn'),
    serviceCountdown: getEl('service-countdown'),
    serviceProgress: getEl('service-progress'),
    fuelEfficiency: getEl('fuel-efficiency'),
    odometerVal: getEl('odometer-val'),
    serviceDoneBtn: getEl('service-done-btn'),
    addFuelBtn: getEl('add-fuel-btn'),
    modeTuk: getEl('mode-tuk'),
    modeBike: getEl('mode-bike'),
    basePrice: getEl('base-price'),
    extraPrice: getEl('extra-price'),
    liveSpeed: getEl('live-speed'),
    // Auth Elements
    authScreen: getEl('auth-screen'),
    loginForm: getEl('login-form'),
    signupForm: getEl('signup-form'),
    showSignup: getEl('show-signup'),
    showLogin: getEl('show-login'),
    loginContainer: getEl('login-form-container'),
    signupContainer: getEl('signup-form-container')
};

// 3. Navigation
elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
        const target = item.getAttribute('data-target');
        if (!target) return;

        elements.navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        elements.pages.forEach(p => {
            p.classList.remove('active');
            if (p.id === target) p.classList.add('active');
        });

        if (target === 'stats') {
            initStats();
            renderExpenses();
        }
        if (target === 'settings') {
            renderDayEndLogs();
            updateHeader(); // Ensure header is fresh

            // Mode Selectors
            if (elements.modeTuk && elements.modeBike) {
                elements.modeTuk.classList.toggle('active', state.settings.vehicleMode === 'tuk');
                elements.modeBike.classList.toggle('active', state.settings.vehicleMode === 'bike');
            }

            // Pricing Inputs
            const currentPricing = getPricing();
            if (elements.basePrice) elements.basePrice.value = currentPricing.firstKm;
            if (elements.extraPrice) elements.extraPrice.value = currentPricing.nextKm;

            // Cloud Status Check
            if (getEl('cloud-status-text')) {
                const statusText = getEl('cloud-status-text');
                const indicator = document.querySelector('.indicator');

                if (supabaseClient) {
                    statusText.textContent = "Supabase DB Connected";
                    statusText.style.color = "var(--success)";
                    if (indicator) indicator.className = 'indicator online';
                } else {
                    statusText.textContent = "Supabase DB Not Configured";
                    if (indicator) indicator.className = 'indicator';
                }
            }
            if (getEl('gsheet-url')) {
                getEl('gsheet-url').value = state.gsheetUrl;
                getEl('gsheet-url').addEventListener('change', (e) => {
                    state.gsheetUrl = e.target.value.trim();
                    localStorage.setItem('gsheet_url', state.gsheetUrl);
                });
            }
        }
    });
});

// 4. Modal & Meter UI Logic
if (elements.addTripBtn) elements.addTripBtn.addEventListener('click', () => { if (elements.tripModal) elements.tripModal.classList.add('active'); });
if (elements.addExpenseBtn) elements.addExpenseBtn.addEventListener('click', () => { if (elements.expenseModal) elements.expenseModal.classList.add('active'); });
if (elements.startMeterBtn) elements.startMeterBtn.addEventListener('click', startTaxiMeter);

// --- Premium Trip Slider Logic ---
function initTripSlider() {
    const thumb = elements.sliderThumb;
    const track = elements.sliderTrack;
    if (!thumb || !track) return;

    let isDragging = false;
    let startX = 0;
    let maxSlide = 0;

    const onStart = (e) => {
        isDragging = true;
        startX = (e.type === 'touchstart') ? e.touches[0].clientX : e.clientX;
        thumb.style.transition = 'none';
        maxSlide = track.offsetWidth - thumb.offsetWidth - 16;
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const currentX = (e.type === 'touchmove') ? e.touches[0].clientX : e.clientX;
        let deltaX = currentX - startX;

        // Boundaries
        deltaX = Math.max(0, Math.min(deltaX, maxSlide));
        thumb.style.transform = `translateX(${deltaX}px)`;

        // Progress effect
        const progress = deltaX / (maxSlide || 1);
        track.style.background = `rgba(239, 68, 68, ${0.1 + (progress * 0.4)})`;

        if (progress > 0.9) {
            track.classList.add('completed');
        } else {
            track.classList.remove('completed');
        }

        // Prevent scrolling while sliding
        if (e.type === 'touchmove') e.preventDefault();
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;

        const currentMatrix = new WebKitCSSMatrix(getComputedStyle(thumb).transform);
        const currentX = currentMatrix.m41;

        if (currentX >= maxSlide * 0.85) {
            // Confirm End Trip
            thumb.style.transform = `translateX(${maxSlide}px)`;
            setTimeout(() => {
                stopTaxiMeter();
                resetSlider();
            }, 200);
        } else {
            resetSlider();
        }
    };

    const resetSlider = () => {
        thumb.style.transition = 'transform 0.3s ease-out';
        thumb.style.transform = 'translateX(0)';
        track.classList.remove('completed');
        track.style.background = 'rgba(239, 68, 68, 0.1)';
    };

    thumb.addEventListener('mousedown', onStart);
    thumb.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
}

initTripSlider();

if (elements.closeMeterBtn) {
    elements.closeMeterBtn.addEventListener('click', () => {
        if (!meter.active || confirm('Trip is still running. Close meter display?')) {
            if (elements.meterScreen) elements.meterScreen.classList.remove('active');
        }
    });
}

if (elements.dayEndBtn) elements.dayEndBtn.addEventListener('click', runDayEnd);

elements.closeModalBtns.forEach(btn => btn.addEventListener('click', () => { if (elements.tripModal) elements.tripModal.classList.remove('active'); }));
if (elements.closeExpenseModalBtn) elements.closeExpenseModalBtn.addEventListener('click', () => { if (elements.expenseModal) elements.expenseModal.classList.remove('active'); });
if (elements.closeDayModalBtn) elements.closeDayModalBtn.addEventListener('click', () => { if (elements.dayEndModal) elements.dayEndModal.classList.remove('active'); });
if (elements.syncSqlBtn) elements.syncSqlBtn.addEventListener('click', syncAllToCloud);

// Vehicle & Settings Listeners
if (elements.addFuelBtn) elements.addFuelBtn.addEventListener('click', () => { if (elements.fuelModal) elements.fuelModal.classList.add('active'); });
if (document.querySelector('.close-fuel-modal')) document.querySelector('.close-fuel-modal').addEventListener('click', () => { if (elements.fuelModal) elements.fuelModal.classList.remove('active'); });

if (elements.updateOdoBtn) {
    elements.updateOdoBtn.addEventListener('click', () => {
        const val = parseInt(elements.odoInput.value);
        if (!isNaN(val)) {
            state.settings.odometer = val;
            saveSettings();
            updateVehicleUI();
        }
    });
}

if (elements.serviceDoneBtn) {
    elements.serviceDoneBtn.addEventListener('click', () => {
        if (confirm("Reset service countdown to 2500km?")) {
            state.settings.lastService = state.settings.odometer;
            saveSettings();
            updateVehicleUI();
        }
    });
}

if (elements.voiceToggle) {
    elements.voiceToggle.addEventListener('change', (e) => {
        state.settings.voiceFeedback = e.target.checked;
        saveSettings();
    });
}

if (elements.voiceLang) {
    elements.voiceLang.addEventListener('change', (e) => {
        state.settings.sinhalaVoice = e.target.value === 'si';
        saveSettings();
    });
}

if (elements.whatsappBtn) {
    elements.whatsappBtn.addEventListener('click', () => {
        const today = new Date().toLocaleDateString();
        const text = `🛺 *Tuktuk Day End Summary* (${today})\n\n` +
            `Total Hires: ${getEl('sum-hires').textContent}\n` +
            `Gross Income: ${getEl('sum-income').textContent}\n` +
            `Expenses: ${getEl('sum-expenses').textContent}\n` +
            `*Net Profit: ${getEl('sum-profit').textContent}*\n\n` +
            `Generated by Tuktuk Hire Manager`;
        shareToWhatsApp(text);
    });
}

if (elements.fuelForm) {
    elements.fuelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseFloat(getEl('fuel-liters').value);
        const cost = parseFloat(getEl('fuel-cost').value);
        const odo = parseInt(getEl('fuel-odo').value);

        const log = {
            id: Date.now(),
            date: new Date().toISOString(),
            liters: amount,
            cost: cost,
            odometer: odo
        };

        state.fuelLogs.unshift(log);
        await db.fuelLogs.add(log);

        // Update vehicle odometer if this is higher
        if (odo > state.settings.odometer) state.settings.odometer = odo;

        saveSettings();
        elements.fuelForm.reset();
        if (elements.fuelModal) elements.fuelModal.classList.remove('active');
        updateVehicleUI();
        renderFuelLogs();

        // Sync to Cloud
        await sendFuelToCloud(log);
    });
}

if (elements.modeTuk) {
    elements.modeTuk.addEventListener('click', () => {
        state.settings.vehicleMode = 'tuk';
        saveSettings();
        updateVehicleModeUI();
    });
}

if (elements.modeBike) {
    elements.modeBike.addEventListener('click', () => {
        state.settings.vehicleMode = 'bike';
        saveSettings();
        updateVehicleModeUI();
    });
}

if (elements.basePrice) {
    elements.basePrice.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
            state.settings.pricing[state.settings.vehicleMode].firstKm = val;
            saveSettings();
        }
    });
}

if (elements.extraPrice) {
    elements.extraPrice.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
            state.settings.pricing[state.settings.vehicleMode].nextKm = val;
            saveSettings();
        }
    });
}

function updateVehicleModeUI() {
    const isTuk = state.settings.vehicleMode === 'tuk';
    if (elements.modeTuk) elements.modeTuk.classList.toggle('active', isTuk);
    if (elements.modeBike) elements.modeBike.classList.toggle('active', !isTuk);

    // Switch Theme Class
    document.body.className = isTuk ? 'theme-tuk' : 'theme-bike';

    updateHeader();

    // Refresh pricing inputs
    const currentPricing = getPricing();
    if (elements.basePrice) elements.basePrice.value = currentPricing.firstKm;
    if (elements.extraPrice) elements.extraPrice.value = currentPricing.nextKm;
}

// 5. Meter Logic
function startTaxiMeter() {
    if (!navigator.geolocation) {
        alert('GPS is not supported on your device.');
        return;
    }

    const currentPricing = getPricing();
    meter.active = true;
    meter.distance = 0;
    meter.fare = currentPricing.firstKm;
    meter.startTime = new Date();
    meter.lastPos = null;
    meter.path = [];

    // Trigger Fullscreen on Android/Desktop
    try {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen()["catch"](function () { });
        } else if (document.documentElement.webkitRequestFullscreen && !/iPhone|iPod|iPad/.test(navigator.userAgent)) {
            document.documentElement.webkitRequestFullscreen();
        }
    } catch (e) {
        console.log("Fullscreen not supported");
    }

    if (elements.meterScreen) elements.meterScreen.classList.add('active');
    updateMeterUI();

    // Initialize Map
    setTimeout(initMap, 100);

    meter.watchId = navigator.geolocation.watchPosition(
        handleGpsUpdate,
        (err) => console.warn('GPS Error:', err),
        { enableHighAccuracy: true, maximumAge: 1000 }
    );

    meter.timerId = setInterval(updateDuration, 1000);
}

function initMap() {
    if (meter.map) {
        meter.map.remove();
    }

    // Default to Colombo center if no GPS yet
    meter.map = L.map('meter-map').setView([6.9271, 79.8612], 15);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(meter.map);

    meter.trackLayer = L.polyline([], { color: '#3b82f6', weight: 5 }).addTo(meter.map);
    meter.marker = L.circleMarker([6.9271, 79.8612], {
        radius: 8,
        color: '#fff',
        fillColor: '#3b82f6',
        fillOpacity: 1
    }).addTo(meter.map);
}

function handleGpsUpdate(position) {
    if (!meter.active) return;
    const currentPos = { lat: position.coords.latitude, lng: position.coords.longitude };

    // Update Map
    if (meter.map) {
        meter.map.setView([currentPos.lat, currentPos.lng]);
        meter.path.push([currentPos.lat, currentPos.lng]);
        meter.trackLayer.setLatLngs(meter.path);
        meter.marker.setLatLng([currentPos.lat, currentPos.lng]);
    }

    // Update Speed
    if (elements.liveSpeed) {
        const speedKmh = position.coords.speed ? Math.round(position.coords.speed * 3.6) : 0;
        elements.liveSpeed.textContent = speedKmh;
    }

    if (meter.lastPos) {
        const dist = calculateDistance(meter.lastPos.lat, meter.lastPos.lng, currentPos.lat, currentPos.lng);
        if (dist > 0.005) {
            meter.distance += dist;
            const currentPricing = getPricing();
            meter.fare = meter.distance <= 1 ? currentPricing.firstKm : currentPricing.firstKm + (meter.distance - 1) * currentPricing.nextKm;
            meter.lastPos = currentPos;
            updateMeterUI();
        }
    } else {
        meter.lastPos = currentPos;
    }
}

function stopTaxiMeter() {
    // Capture path as a string or array to save
    const tripPath = [...meter.path];

    saveTrip({
        id: Date.now(),
        pickup: 'GPS Trip',
        destination: 'Arrived',
        fare: Math.round(meter.fare),
        distance: parseFloat(meter.distance.toFixed(2)),
        payment: 'cash',
        date: new Date().toISOString(),
        type: 'meter',
        path: tripPath,
        archived: false
    });

    meter.active = false;
    navigator.geolocation.clearWatch(meter.watchId);
    if (meter.timerId) clearInterval(meter.timerId);

    if (meter.map) {
        meter.map.remove();
        meter.map = null;
    }

    if (elements.meterScreen) elements.meterScreen.classList.remove('active');
    updateUI();
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function updateMeterUI() {
    if (getEl('live-fare')) getEl('live-fare').textContent = Math.round(meter.fare).toFixed(2);
    if (getEl('live-distance')) getEl('live-distance').innerHTML = `${meter.distance.toFixed(2)} <small>km</small>`;
}

function updateDuration() {
    if (!meter.startTime) return;
    const diff = Math.floor((new Date() - meter.startTime) / 1000);
    const mins = Math.floor(diff / 60).toString().padStart(2, '0');
    const secs = (diff % 60).toString().padStart(2, '0');
    if (getEl('live-duration')) getEl('live-duration').textContent = `${mins}:${secs}`;
}

// 6. Day End Logic
async function runDayEnd() {
    if (!confirm('Are you sure you want to close today? This will clear the dashboard.')) return;
    const today = new Date().toLocaleDateString();

    const activeTodayTrips = state.trips.filter(t => new Date(t.date).toLocaleDateString() === today && !t.archived);
    const activeTodayExpenses = state.expenses.filter(e => new Date(e.date).toLocaleDateString() === today && !e.archived);

    if (activeTodayTrips.length === 0 && activeTodayExpenses.length === 0) {
        alert("No active hires or expenses found for today to close.");
        return;
    }

    const totalIncome = activeTodayTrips.reduce((acc, t) => acc + t.fare, 0);
    const totalExpenses = activeTodayExpenses.reduce((acc, e) => acc + e.amount, 0);
    const profit = totalIncome - totalExpenses;

    for (let t of state.trips) { if (new Date(t.date).toLocaleDateString() === today) t.archived = true; }
    for (let e of state.expenses) { if (new Date(e.date).toLocaleDateString() === today) e.archived = true; }

    const newLog = {
        id: Date.now(),
        date: today, trips: activeTodayTrips.length, income: totalIncome, expenses: totalExpenses, profit: profit, closedAt: new Date().toISOString()
    };
    state.dayEndLogs.unshift(newLog);

    // Local IndexedDB save - try separately
    try {
        await db.trips.toCollection().modify(t => { if (new Date(t.date).toLocaleDateString() === today) t.archived = true; });
        await db.expenses.toCollection().modify(e => { if (new Date(e.date).toLocaleDateString() === today) e.archived = true; });
        await db.dayEndLogs.put(newLog);
    } catch (dbErr) {
        console.error("IndexedDB Day End Error:", dbErr);
    }

    if (getEl('sum-hires')) getEl('sum-hires').textContent = activeTodayTrips.length;
    if (getEl('sum-income')) getEl('sum-income').textContent = `Rs. ${totalIncome.toFixed(2)}`;
    if (getEl('sum-expenses')) getEl('sum-expenses').textContent = `Rs. ${totalExpenses.toFixed(2)}`;
    if (getEl('sum-profit')) getEl('sum-profit').textContent = `Rs. ${profit.toFixed(2)}`;

    if (elements.dayEndModal) elements.dayEndModal.classList.add('active');

    // Ensure lists are cleared immediately for the user
    updateUI();
    renderDayEndLogs();
    renderExpenses();

    // Cloud Sync
    await sendDayEndToCloud(newLog);
}

function renderDayEndLogs() {
    if (!elements.logsContainer) return;
    elements.logsContainer.innerHTML = state.dayEndLogs.length ? state.dayEndLogs.map(log => `
        <div class="log-item">
            <div class="log-info">
                <span class="log-date">${log.date}</span>
                <p>${log.trips} Hires • Profit: Rs. ${log.profit.toFixed(0)}</p>
                <small style="color:var(--text-dim); font-size:10px;">Closed at: ${new Date(log.closedAt).toLocaleTimeString()}</small>
            </div>
            <div class="log-profit">Rs. ${log.profit.toFixed(0)}</div>
        </div>
    `).join('') : '<p class="empty-state">No logs yet.</p>';
}

// 7. Data Handlers - Supabase Database Sync
async function sendToCloud(trip) {
    if (!state.user || !supabaseClient) return;
    try {
        const { error } = await supabaseClient
            .from('trips')
            .upsert({ ...trip, user_id: state.user.id });
        if (error) throw error;
        console.log("✅ Trip synced to Supabase!");
    } catch (error) {
        console.error("Supabase Sync Error (Trip):", error);
        alert("Trip Sync Error: " + (error.message || "Unknown Error"));
    }
}

async function saveTrip(trip) {
    state.trips.unshift(trip);
    await db.trips.add(trip);
    updateUI();

    // Sync to Cloud
    await sendToCloud(trip);

    // Sync to Google Sheet
    await sendToGoogleSheet(trip);

    // Voice Announcement
    speakFare(trip.fare);
}

async function sendToGoogleSheet(data) {
    if (!state.gsheetUrl) return;
    try {
        await fetch(state.gsheetUrl, {
            method: 'POST',
            mode: 'no-cors', // Apps Script requires no-cors sometimes for simple POST
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        console.log("✅ Google Sheet synced!");
    } catch (e) {
        console.error("❌ Google Sheet Error:", e);
    }
}

async function syncAllToCloud(silent = false) {
    if (!state.user || !supabaseClient) {
        if (!silent) alert("Cloud sync requires login.");
        return;
    }
    if (!state.trips.length && !state.expenses.length && !state.dayEndLogs.length && !state.fuelLogs.length) {
        if (!silent) alert("No data to sync!");
        return;
    }

    const btn = elements.syncSqlBtn;
    if (btn) { btn.disabled = true; btn.textContent = "Syncing..."; }

    try {
        const uid = state.user.id;

        // Sync Trips
        if (state.trips.length) {
            const { error: tErr } = await supabaseClient.from('trips').upsert(state.trips.map(t => ({ ...t, user_id: uid })));
            if (tErr) throw tErr;
        }

        // Sync Expenses
        if (state.expenses.length) {
            const { error: eErr } = await supabaseClient.from('expenses').upsert(state.expenses.map(e => ({ ...e, user_id: uid })));
            if (eErr) throw eErr;
        }

        // Sync DayEnd Logs
        if (state.dayEndLogs.length) {
            const mappedLogs = state.dayEndLogs.map(l => {
                const payload = { ...l, user_id: uid };
                if (payload.closedAt) {
                    payload.closedat = payload.closedAt;
                    delete payload.closedAt;
                }
                // Ensure id exists for older logs
                if (!payload.id) {
                    payload.id = new Date(payload.closedat || payload.date || Date.now()).getTime() || Date.now();
                }
                return payload;
            });
            const { error: dErr } = await supabaseClient.from('day_end_logs').upsert(mappedLogs);
            if (dErr) throw dErr;
        }

        // Sync Fuel Logs
        if (state.fuelLogs.length) {
            const { error: fErr } = await supabaseClient.from('fuel_logs').upsert(state.fuelLogs.map(f => ({ ...f, user_id: uid })));
            if (fErr) throw fErr;
        }

        console.log("✅ Batch Sync Successful!");

        if (btn) { btn.disabled = false; btn.textContent = "Cloud Sync"; }
        if (!silent) alert(`☁️ Cloud Sync සම්පූර්ණයි!\nඔබේ දත්ත Supabase Database එකට සුරක්ෂිතව යැවුවා.`);
    } catch (e) {
        console.error("❌ Batch Sync Error:", e);
        if (btn) { btn.disabled = false; btn.textContent = "Cloud Sync"; }
        if (!silent) alert("⚠️ දත්ත යැවීමේදී දෝෂයක් ඇතිවිය: " + e.message);
    }
}

async function sendFuelToCloud(fuel) {
    if (!state.user || !supabaseClient) return;
    try {
        const { error } = await supabaseClient
            .from('fuel_logs')
            .upsert({ ...fuel, user_id: state.user.id });
        if (error) throw error;
        console.log("✅ Fuel Log synced to Supabase!");
    } catch (e) { console.error("Supabase Fuel Error", e); }
}

async function sendExpenseToCloud(expense) {
    if (!state.user || !supabaseClient) return;
    try {
        const { error } = await supabaseClient
            .from('expenses')
            .upsert({ ...expense, user_id: state.user.id });
        if (error) throw error;
        console.log("✅ Expense synced to Supabase!");
    } catch (e) { console.error("Supabase Expense Error", e); }
}

async function sendDayEndToCloud(log) {
    if (!state.user || !supabaseClient) return;
    try {
        const payload = { ...log, user_id: state.user.id };
        // Postgres enforces lowercase unless quoted, so we must send 'closedat'
        if (payload.closedAt) {
            payload.closedat = payload.closedAt;
            delete payload.closedAt;
        }

        // Ensure id exists for older logs that didn't have an id initially
        if (!payload.id) {
            payload.id = new Date(payload.closedat || payload.date || Date.now()).getTime() || Date.now();
        }

        const { error } = await supabaseClient
            .from('day_end_logs')
            .upsert(payload);
        if (error) throw error;
        console.log("✅ DayEnd Log synced to Supabase!");
    } catch (e) {
        console.error("Supabase DayEnd Error", e);
        alert("Day End Cloud Sync Error: " + (e.message || "Unknown Error"));
    }
}

if (elements.tripForm) {
    elements.tripForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveTrip({
            id: Date.now(),
            pickup: getEl('pickup').value,
            destination: getEl('destination').value,
            fare: parseFloat(getEl('fare').value),
            distance: parseFloat(getEl('distance').value) || 0,
            payment: document.querySelector('input[name="payment"]:checked').value,
            date: new Date().toISOString(),
            archived: false,
            path: [] // Manual entry has no path
        });
        elements.tripForm.reset();
        if (elements.tripModal) elements.tripModal.classList.remove('active');
    });
}

if (elements.expenseForm) {
    elements.expenseForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const expense = {
            id: Date.now(),
            type: getEl('expense-type').value,
            amount: parseFloat(getEl('expense-amount').value),
            note: getEl('expense-note').value,
            date: new Date().toISOString(),
            archived: false
        };
        state.expenses.unshift(expense);
        await db.expenses.add(expense);
        elements.expenseForm.reset();
        if (elements.expenseModal) elements.expenseModal.classList.remove('active');
        updateUI();
        renderExpenses();

        // Sync to Cloud
        await sendExpenseToCloud(expense);
    });
}

// 8. UI Rendering
function updateUI() {
    const today = new Date().toLocaleDateString();
    const activeTodayTrips = state.trips.filter(t => new Date(t.date).toLocaleDateString() === today && !t.archived);
    const activeTodayExpenses = state.expenses.filter(e => new Date(e.date).toLocaleDateString() === today && !e.archived);

    const todayIncome = activeTodayTrips.reduce((acc, t) => acc + t.fare, 0);
    const todayExpenses = activeTodayExpenses.reduce((acc, e) => acc + e.amount, 0);

    if (getEl('today-income')) getEl('today-income').textContent = `Rs. ${todayIncome.toFixed(2)}`;
    if (getEl('today-trips')) getEl('today-trips').textContent = activeTodayTrips.length;
    if (getEl('today-expenses')) getEl('today-expenses').textContent = `Rs. ${todayExpenses.toFixed(0)}`;

    renderTrips(activeTodayTrips.slice(0, 5), elements.recentTripsList);

    // History tab should only show non-archived trips by default as requested
    const activeHistory = state.trips.filter(t => !t.archived);
    renderTrips(activeHistory, elements.fullHistoryList);
}

function renderTrips(trips, container) {
    if (!container) return;
    container.innerHTML = trips.length ? trips.map(t => `
        <div class="trip-item ${t.archived ? 'archived' : ''}">
            <div class="trip-info">
                <h4>${t.pickup} → ${t.destination}</h4>
                <p>${new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${t.distance} km • ${t.payment} ${t.archived ? '(Closed)' : ''}</p>
                ${t.path && t.path.length > 0 ? `<button class="view-path-btn" onclick="showTripPath(${t.id})">🗺️ View Path</button>` : ''}
            </div>
            <div class="trip-amount"><span class="fare">Rs. ${t.fare.toFixed(2)}</span></div>
        </div>
    `).join('') : '<div class="empty-state"><i data-lucide="map-pin"></i><p>No hires recorded.</p></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Function to show captured path in a temporary modal or alert for now
window.showTripPath = (tripId) => {
    const trip = state.trips.find(t => t.id === tripId);
    if (!trip || !trip.path) return;

    // Create a temporary full-screen map modal
    const mapModal = document.createElement('div');
    mapModal.className = 'meter-overlay active';
    mapModal.style.zIndex = '3000';
    mapModal.innerHTML = `
        <div class="meter-content-full">
            <div class="meter-header">
                <h3>Trip Path: ${trip.pickup}</h3>
                <button onclick="this.closest('.meter-overlay').remove()" class="icon-btn"><i data-lucide="x"></i></button>
            </div>
            <div id="history-map" style="flex:1; border-radius:24px; margin:20px 0;"></div>
            <div class="meter-stats">
                <div class="m-stat"><span class="label">Distance</span><h2>${trip.distance} km</h2></div>
                <div class="m-stat"><span class="label">Fare</span><h2>Rs. ${trip.fare}</h2></div>
            </div>
        </div>
    `;
    document.body.appendChild(mapModal);
    lucide.createIcons();

    const hMap = L.map('history-map').setView(trip.path[0], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(hMap);
    L.polyline(trip.path, { color: '#3b82f6', weight: 5 }).addTo(hMap);

    // Fit map to path
    const bounds = L.latLngBounds(trip.path);
    hMap.fitBounds(bounds, { padding: [20, 20] });
};

function renderExpenses() {
    if (!elements.expenseList) return;
    const activeExpenses = state.expenses.filter(e => !e.archived);
    elements.expenseList.innerHTML = activeExpenses.length ? activeExpenses.slice(0, 5).map(e => `
        <div class="expense-item">
            <div class="expense-info"><h4>${e.type}</h4><p>${new Date(e.date).toLocaleDateString()} • ${e.note || 'No note'}</p></div>
            <div class="expense-amount">-Rs. ${e.amount.toFixed(2)}</div>
        </div>
    `).join('') : '<p class="empty-state">No active expenses.</p>';
}

function updateVehicleUI() {
    if (elements.odometerVal) elements.odometerVal.textContent = `${state.settings.odometer} km`;
    if (getEl('current-odo-display')) getEl('current-odo-display').textContent = state.settings.odometer;
    if (elements.odoInput) elements.odoInput.value = state.settings.odometer;

    const distanceSinceService = state.settings.odometer - state.settings.lastService;
    const remaining = Math.max(0, state.settings.serviceInterval - distanceSinceService);
    const progress = Math.min(100, (distanceSinceService / state.settings.serviceInterval) * 100);

    if (elements.serviceCountdown) elements.serviceCountdown.textContent = `${remaining} km`;
    if (elements.serviceProgress) {
        elements.serviceProgress.style.width = `${progress}%`;
        elements.serviceProgress.style.backgroundColor = progress > 90 ? '#ef4444' : progress > 70 ? '#ffcc00' : '#22c55e';
    }

    // Fuel Efficiency Calculation (Km per Liter)
    if (state.fuelLogs.length >= 2) {
        const last = state.fuelLogs[0];
        const prev = state.fuelLogs[1];
        const dist = last.odometer - prev.odometer;
        const efficiency = dist / last.liters; // Estimating by liters filled to reach this odo
        if (elements.fuelEfficiency) elements.fuelEfficiency.innerHTML = `${efficiency.toFixed(1)} <small>km/L</small>`;
    }
}

function renderFuelLogs() {
    if (!elements.fuelList) return;
    elements.fuelList.innerHTML = state.fuelLogs.length ? state.fuelLogs.slice(0, 5).map(log => `
        <div class="trip-item">
            <div class="trip-info">
                <h4>Fuel Up: ${log.liters}L</h4>
                <p>${new Date(log.date).toLocaleDateString()} • Odo: ${log.odometer} km</p>
            </div>
            <div class="trip-amount"><span class="fare">Rs. ${log.cost}</span></div>
        </div>
    `).join('') : '<p class="empty-state">No fuel records.</p>';
}

async function saveSettings() {
    var settingsToSave = {};
    for (var key in state.settings) {
        settingsToSave[key] = state.settings[key];
    }
    settingsToSave.id = 1;
    await db.settings.put(settingsToSave);
}

// 9. Stats
let incomeChart = null;
function initStats() {
    const ctx = getEl('incomeChart');
    if (!ctx || typeof Chart === 'undefined') return;
    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - i); return d.toLocaleDateString();
    }).reverse();
    const data = last7Days.map(date => state.trips.filter(t => new Date(t.date).toLocaleDateString() === date).reduce((acc, t) => acc + t.fare, 0));

    if (incomeChart) incomeChart.destroy();
    incomeChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: last7Days.map(d => d.split('/')[0] + '/' + d.split('/')[1]),
            datasets: [{ label: 'Earnings', data: data, borderColor: '#ffcc00', backgroundColor: 'rgba(255, 204, 0, 0.1)', borderWidth: 3, tension: 0.4, fill: true }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }
    });

    const totalIncome = state.trips.reduce((acc, t) => acc + t.fare, 0);
    const totalExp = state.expenses.reduce((acc, e) => acc + e.amount, 0);
    if (getEl('weekly-profit')) getEl('weekly-profit').textContent = `Rs. ${(totalIncome - totalExp).toFixed(2)}`;
    if (getEl('avg-fare')) getEl('avg-fare').textContent = `Rs. ${(state.trips.length ? totalIncome / state.trips.length : 0).toFixed(0)}`;
}

// 12. Voice Feedback Logic
function speakFare(amount) {
    if (!state.settings.voiceFeedback) return;

    const text = state.settings.sinhalaVoice
        ? `ඔබේ ගාස්තුව රුපියල් ${amount} යි.`
        : `Your fare is ${amount} rupees.`;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = state.settings.sinhalaVoice ? 'si-LK' : 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
}

// 13. WhatsApp Sharing Logic
function shareToWhatsApp(text) {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

// Initial Run
updateUI();
updateHeader();
if (typeof lucide !== 'undefined') lucide.createIcons();

// Auto-Sync to Cloud on load
setTimeout(() => {
    console.log("Auto-syncing to Cloud...");
    syncAllToCloud(true); // true = silent background sync
}, 3000);

// 10. Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker Registered!', reg))
            .catch(err => console.log('Service Worker Error', err));
    });
}

// 11. PWA Installation Handler
let deferredPrompt;
const installBtn = getEl('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI notify the user they can install the PWA
    if (installBtn) {
        installBtn.style.display = 'flex';
        installBtn.style.alignItems = 'center';
        installBtn.style.gap = '5px';
    }
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        // Show the install prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        // We've used the prompt, and can't use it again, throw it away
        deferredPrompt = null;
        installBtn.style.display = 'none';
    });
}

window.addEventListener('appinstalled', (event) => {
    console.log('👍', 'appinstalled', event);
    // Clear the deferredPrompt so it can be garbage collected
    deferredPrompt = null;
    if (installBtn) installBtn.style.display = 'none';
});
// 14. Auth & Entrance Logic
function enterApp() {
    if (elements.authScreen) elements.authScreen.style.display = 'none';
    const splash = getEl('splash-screen');
    if (splash) splash.style.display = 'none';
    if (mainApp) mainApp.style.display = 'flex';
    if (getEl('driver-name')) getEl('driver-name').textContent = state.user ? state.user.name : 'Captain';
    updateUI();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

if (elements.showSignup) {
    elements.showSignup.addEventListener('click', (e) => {
        e.preventDefault();
        elements.loginContainer.style.display = 'none';
        elements.signupContainer.style.display = 'block';
        getEl('auth-title').textContent = 'Create Account';
        getEl('auth-subtitle').textContent = 'Join TukTuk Go family';
    });
}

if (elements.showLogin) {
    elements.showLogin.addEventListener('click', (e) => {
        e.preventDefault();
        elements.loginContainer.style.display = 'block';
        elements.signupContainer.style.display = 'none';
        getEl('auth-title').textContent = 'Welcome Back';
        getEl('auth-subtitle').textContent = 'Login to sync your data';
    });
}

if (elements.loginForm) {
    elements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        let id = getEl('login-id').value;
        const pass = getEl('login-pass').value;

        // Supabase requires email format
        const email = id.includes('@') ? id : `${id}@tuktukgo.local`;

        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: pass,
            });

            if (error) throw error;

            const user = data.user;
            state.user = {
                name: user.user_metadata.full_name || 'Captain',
                id: user.id,
                email: user.email
            };
            localStorage.setItem('tuk_user', JSON.stringify(state.user));

            // Record login event in login_logs table
            try {
                await supabaseClient.from('login_logs').insert({
                    user_id: user.id,
                    user_email: user.email,
                    logged_in_at: new Date().toISOString()
                });
            } catch (logErr) {
                console.warn('Login log failed (table may not exist):', logErr.message);
            }

            enterApp();
        } catch (err) {
            console.error(err);
            if (err.message && (err.message.toLowerCase().includes('email not confirmed') || err.message.toLowerCase().includes('not confirmed'))) {
                alert(
                    '⚠️ Email Confirm Kala Naha!\n\n' +
                    'Meka fix karanna method 2 thiyanawa:\n\n' +
                    '① Supabase Dashboard eke:\n' +
                    '   Authentication → Users → oya user row eke "..." → "Confirm user"\n\n' +
                    '② Permanent fix:\n' +
                    '   Authentication → Providers → Email → "Confirm email" OFF karanna'
                );
            } else if (err.message && err.message.toLowerCase().includes('invalid login credentials')) {
                alert('⚠️ Email/Password hariyata naha.\nDanna details check karanna.');
            } else {
                alert(err.message || 'Login failed');
            }
        }
    });
}

if (elements.signupForm) {
    elements.signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = getEl('signup-name').value;
        let id = getEl('signup-id').value;
        const pass = getEl('signup-pass').value;

        const email = id.includes('@') ? id : `${id}@tuktukgo.local`;

        try {
            const { data, error } = await supabaseClient.auth.signUp({
                email: email,
                password: pass,
                options: {
                    data: {
                        full_name: name,
                    }
                }
            });

            if (error) throw error;

            const user = data.user;
            state.user = {
                name: name,
                id: user.id,
                email: email
            };
            localStorage.setItem('tuk_user', JSON.stringify(state.user));
            enterApp();
        } catch (err) {
            console.error(err);
            if (err.message && err.message.toLowerCase().includes('rate limit')) {
                alert('⚠️ Email limit exceeded!\n\nSupabase Dashboard eke:\nAuthentication → Providers → Email → "Confirm email" OFF කරන්න.\n\nEheddi email eka nathuwama register karanna puluwan!');
            } else if (err.message && err.message.toLowerCase().includes('already registered')) {
                alert('⚠️ Me email eka already registered.\nLogin page ekata gihin login karanna.');
            } else {
                alert(err.message || 'Registration failed');
            }
        }
    });
}

// 15. Splash Screen Handler Updated
const splashScreen = getEl('splash-screen');
const splashBtn = getEl('splash-btn');
const mainApp = getEl('app');

if (splashBtn && splashScreen) {
    splashBtn.addEventListener('click', () => {
        splashScreen.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        splashScreen.style.opacity = '0';
        splashScreen.style.transform = 'scale(1.1)';

        setTimeout(() => {
            splashScreen.style.display = 'none';
            if (state.user) {
                enterApp();
            } else {
                if (elements.authScreen) elements.authScreen.style.display = 'flex';
            }
        }, 500);
    });
}

if (getEl('logout-btn')) {
    getEl('logout-btn').addEventListener('click', () => {
        if (confirm("Are you sure you want to logout?")) {
            localStorage.removeItem('tuk_user');
            state.user = null;
            location.reload();
        }
    });
}

if (getEl('skip-auth')) {
    getEl('skip-auth').addEventListener('click', () => {
        console.log("Entering app in Offline/Guest mode");
        enterApp();
    });
}
