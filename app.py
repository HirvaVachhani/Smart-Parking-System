import os
import sqlite3
from flask import Flask, render_template, request, jsonify, session
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = 'super_secret_parking_key_for_demo'
db_path = os.path.join(app.root_path, 'database.db')

def init_db():
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    # Create slots table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_number TEXT NOT NULL,
            is_available BOOLEAN NOT NULL DEFAULT 1,
            price_per_hour REAL NOT NULL
        )
    ''')
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL
        )
    ''')
    # Create bookings table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            vehicle_number TEXT NOT NULL,
            user_name TEXT NOT NULL,
            start_time DATETIME NOT NULL,
            end_time DATETIME,
            amount_paid REAL,
            status TEXT NOT NULL,
            FOREIGN KEY (slot_id) REFERENCES slots (id),
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')

    # Check if slots exist, if not insert default 12 slots
    if cursor.execute('SELECT COUNT(*) FROM slots').fetchone()[0] == 0:
        for i in range(1, 13):
            floor = 1 if i <= 6 else 2
            num = (i - 1) % 6 + 1
            cursor.execute("INSERT INTO slots (slot_number, is_available, price_per_hour) VALUES (?, ?, ?)",
                        (f'{floor}F-{num:02d}', True, 5.00))
    
    # Check if admin exists, if not create default
    if cursor.execute('SELECT COUNT(*) FROM users WHERE username = "admin"').fetchone()[0] == 0:
        hashed_pw = generate_password_hash('admin123')
        cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
                       ('admin', hashed_pw, 'admin'))
                       
    conn.commit()
    conn.close()

init_db()

def get_db_connection():
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/')
def index():
    return render_template('index.html')

# === AUTHENTICATION ENDPOINTS ===

@app.route('/api/signup', methods=['POST'])
def signup():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    role = data.get('role', 'user') # 'user' or 'admin'
    
    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400
        
    hashed_pwd = generate_password_hash(password)
    
    conn = get_db_connection()
    try:
        conn.execute('INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
                    (username, hashed_pwd, role))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Username already exists'}), 400
        
    # Auto login after signup
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    session['user_id'] = user['id']
    session['username'] = user['username']
    session['role'] = user['role']
    conn.close()
    
    return jsonify({'success': True, 'user': {'username': username, 'role': role}})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()
    
    if user and check_password_hash(user['password'], password):
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']
        return jsonify({'success': True, 'user': {'username': user['username'], 'role': user['role']}})
        
    return jsonify({'error': 'Invalid username or password'}), 401

@app.route('/api/logout', methods=['POST', 'GET'])
def logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/me', methods=['GET'])
def me():
    if 'user_id' in session:
        return jsonify({'logged_in': True, 'user': {'username': session['username'], 'role': session['role']}})
    return jsonify({'logged_in': False}), 401

# === CORE ENDPOINTS ===

@app.route('/api/slots', methods=['GET'])
def get_slots():
    conn = get_db_connection()
    slots = conn.execute('SELECT * FROM slots').fetchall()
    conn.close()
    return jsonify([dict(ix) for ix in slots])

@app.route('/api/book', methods=['POST'])
def book_slot():
    if 'user_id' not in session:
        return jsonify({'error': 'Must be logged in to book'}), 401
        
    data = request.json
    slot_id = data.get('slot_id')
    vehicle_number = data.get('vehicle_number')
    
    conn = get_db_connection()
    slot = conn.execute('SELECT is_available FROM slots WHERE id = ?', (slot_id,)).fetchone()
    
    if not slot or not slot['is_available']:
        conn.close()
        return jsonify({'error': 'Slot not available'}), 400
        
    cursor = conn.cursor()
    cursor.execute('UPDATE slots SET is_available = 0 WHERE id = ?', (slot_id,))
    cursor.execute('INSERT INTO bookings (slot_id, user_id, vehicle_number, user_name, start_time, status) VALUES (?, ?, ?, ?, ?, ?)',
                   (slot_id, session['user_id'], vehicle_number, session['username'], datetime.now().isoformat(), 'active'))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'message': 'Slot booked successfully'})

@app.route('/api/checkout', methods=['POST'])
def checkout():
    if 'user_id' not in session:
        return jsonify({'error': 'Not logged in'}), 401
        
    data = request.json
    slot_id = data.get('slot_id')
    
    conn = get_db_connection()
    booking = conn.execute("SELECT * FROM bookings WHERE slot_id = ? AND status = 'active'", (slot_id,)).fetchone()
    
    if not booking:
        conn.close()
        return jsonify({'error': 'No active booking found for this slot'}), 404
        
    # Standard users can only checkout their own cars (Admins can checkout anything)
    if session['role'] != 'admin' and booking['user_id'] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Not authorized to checkout this slot. You can only checkout cars you have booked.'}), 403
        
    start_time = datetime.fromisoformat(booking['start_time'])
    end_time = datetime.now()
    duration_hours = max((end_time - start_time).total_seconds() / 3600, 1.0)
    
    slot = conn.execute('SELECT price_per_hour FROM slots WHERE id = ?', (slot_id,)).fetchone()
    amount_paid = round(duration_hours * slot['price_per_hour'], 2)
    
    cursor = conn.cursor()
    cursor.execute('UPDATE slots SET is_available = 1 WHERE id = ?', (slot_id,))
    cursor.execute("UPDATE bookings SET end_time = ?, amount_paid = ?, status = 'completed' WHERE id = ?",
                   (end_time.isoformat(), amount_paid, booking['id']))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'success': True, 
        'message': 'Checkout successful', 
        'amount_paid': amount_paid,
        'duration_hours': round(duration_hours, 2)
    })

@app.route('/api/my_bookings', methods=['GET'])
def my_bookings():
    if 'user_id' not in session:
        return jsonify({'error': 'Not logged in'}), 401
        
    conn = get_db_connection()
    # If admin, see all. If user, see own.
    if session['role'] == 'admin':
        bookings = conn.execute('''
            SELECT b.*, s.slot_number 
            FROM bookings b 
            JOIN slots s ON b.slot_id = s.id 
            ORDER BY b.id DESC LIMIT 50
        ''').fetchall()
    else:
        bookings = conn.execute('''
            SELECT b.*, s.slot_number 
            FROM bookings b 
            JOIN slots s ON b.slot_id = s.id 
            WHERE b.user_id = ? 
            ORDER BY b.id DESC
        ''', (session['user_id'],)).fetchall()
    conn.close()
    return jsonify([dict(ix) for ix in bookings])

@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    if 'user_id' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    
    conn = get_db_connection()
    if session['role'] == 'admin':
        total_revenue = conn.execute("SELECT SUM(amount_paid) FROM bookings WHERE status = 'completed'").fetchone()[0] or 0.0
        total_bookings = conn.execute("SELECT COUNT(*) FROM bookings").fetchone()[0]
        active_bookings = conn.execute("SELECT COUNT(*) FROM bookings WHERE status = 'active'").fetchone()[0]
        revenue_by_slot = conn.execute('''
            SELECT s.slot_number, SUM(b.amount_paid) as total 
            FROM bookings b JOIN slots s ON b.slot_id = s.id 
            WHERE b.status = 'completed' GROUP BY b.slot_id ORDER BY total DESC LIMIT 4
        ''').fetchall()
    else:
        total_revenue = conn.execute("SELECT SUM(amount_paid) FROM bookings WHERE status = 'completed' AND user_id = ?", (session['user_id'],)).fetchone()[0] or 0.0
        total_bookings = conn.execute("SELECT COUNT(*) FROM bookings WHERE user_id = ?", (session['user_id'],)).fetchone()[0]
        active_bookings = conn.execute("SELECT COUNT(*) FROM bookings WHERE status = 'active' AND user_id = ?", (session['user_id'],)).fetchone()[0]
        revenue_by_slot = conn.execute('''
            SELECT s.slot_number, SUM(b.amount_paid) as total 
            FROM bookings b JOIN slots s ON b.slot_id = s.id 
            WHERE b.status = 'completed' AND b.user_id = ? GROUP BY b.slot_id ORDER BY total DESC LIMIT 4
        ''', (session['user_id'],)).fetchall()
        
    conn.close()
    
    return jsonify({
        'total_revenue': round(total_revenue, 2),
        'total_bookings': total_bookings,
        'active_bookings': active_bookings,
        'top_slots': [dict(row) for row in revenue_by_slot]
    })

if __name__ == '__main__':
    app.run(debug=False, port=5000)
