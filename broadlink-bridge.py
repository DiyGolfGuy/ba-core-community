#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════════
#  broadlink-bridge.py — BroadLink IR Bridge Service
#
#  Runs as a separate process on port 3002.
#  Node.js calls this service to send IR commands to BroadLink RM Mini devices.
#
#  The installer runs it as the ba-core-broadlink service when the python3-flask
#  and python3-broadlink system packages are present. By hand:
#  python3 /var/lib/ba-core/app/broadlink-bridge.py
# ═══════════════════════════════════════════════════════════════════════════════

from flask import Flask, request, jsonify
import broadlink
import base64
import time
import json
import os

app = Flask(__name__)

# In-memory store for learn mode
learn_state = { 'device_ip': None, 'waiting': False }

def find_device(ip):
    """Find a BroadLink device by IP address."""
    try:
        devices = broadlink.discover(timeout=5)
        for d in devices:
            if d.host[0] == ip:
                d.auth()
                return d
        return None
    except Exception as e:
        print(f'Discovery error: {e}')
        return None

def get_device(ip):
    """Get and authenticate a BroadLink device by IP."""
    try:
        # Try direct connection first (faster than discovery)
        d = broadlink.hello(ip)
        d.auth()
        return d
    except Exception:
        try:
            return find_device(ip)
        except Exception as e:
            print(f'Device connection error for {ip}: {e}')
            return None

@app.route('/health', methods=['GET'])
def health():
    return jsonify({ 'status': 'ok', 'service': 'broadlink-bridge' })

@app.route('/discover', methods=['GET'])
def discover():
    """Discover all BroadLink devices on the network."""
    try:
        devices = broadlink.discover(timeout=5)
        result = []
        for d in devices:
            try:
                d.auth()
                result.append({
                    'ip':   d.host[0],
                    'mac':  ':'.join(format(x, '02x') for x in d.mac),
                    'type': d.type,
                    'model': str(d.model) if hasattr(d, 'model') else 'RM Mini'
                })
            except Exception:
                pass
        return jsonify({ 'devices': result })
    except Exception as e:
        return jsonify({ 'error': str(e) }), 500

@app.route('/send', methods=['POST'])
def send_command():
    """Send an IR command to a device."""
    data = request.json
    ip      = data.get('ip')
    command = data.get('command')  # base64 encoded IR code

    if not ip or not command:
        return jsonify({ 'error': 'ip and command required' }), 400

    try:
        device = get_device(ip)
        if not device:
            return jsonify({ 'error': f'Could not connect to device at {ip}' }), 500

        # Decode base64 command and send
        packet = base64.b64decode(command)
        device.send_data(packet)
        return jsonify({ 'success': True })
    except Exception as e:
        return jsonify({ 'error': str(e) }), 500

@app.route('/learn/start', methods=['POST'])
def learn_start():
    """Put a device into learning mode to capture an IR code."""
    data = request.json
    ip   = data.get('ip')

    if not ip:
        return jsonify({ 'error': 'ip required' }), 400

    try:
        device = get_device(ip)
        if not device:
            return jsonify({ 'error': f'Could not connect to device at {ip}' }), 500

        device.enter_learning()
        learn_state['device_ip'] = ip
        learn_state['waiting']   = True
        learn_state['device']    = device
        return jsonify({ 'success': True, 'message': 'Point your TV remote at the RM Mini and press the power button' })
    except Exception as e:
        return jsonify({ 'error': str(e) }), 500

@app.route('/learn/capture', methods=['POST'])
def learn_capture():
    """Capture the learned IR code after learn/start."""
    if not learn_state.get('waiting'):
        return jsonify({ 'error': 'Not in learning mode. Call /learn/start first.' }), 400

    try:
        device = learn_state.get('device')
        if not device:
            return jsonify({ 'error': 'No device in learning mode' }), 500

        # Try to get the learned code (retry a few times)
        code = None
        for _ in range(10):
            code = device.check_data()
            if code:
                break
            time.sleep(0.5)

        learn_state['waiting'] = False
        learn_state['device']  = None

        if not code:
            return jsonify({ 'error': 'No IR code captured. Make sure you pressed the remote button.' }), 500

        # Return as base64
        encoded = base64.b64encode(code).decode('utf-8')
        return jsonify({ 'success': True, 'command': encoded })
    except Exception as e:
        learn_state['waiting'] = False
        return jsonify({ 'error': str(e) }), 500

@app.route('/test', methods=['POST'])
def test_device():
    """Test connection to a BroadLink device."""
    data = request.json
    ip   = data.get('ip')
    if not ip:
        return jsonify({ 'error': 'ip required' }), 400
    try:
        device = get_device(ip)
        if device:
            return jsonify({ 'success': True, 'message': f'Connected to {ip}' })
        return jsonify({ 'error': f'Could not connect to {ip}' }), 500
    except Exception as e:
        return jsonify({ 'error': str(e) }), 500

if __name__ == '__main__':
    print('\n  📺  BroadLink IR Bridge')
    print('  ──────────────────────')
    print('  Port: 3002')
    print('  Endpoints:')
    print('    GET  /health')
    print('    GET  /discover')
    print('    POST /send       { ip, command }')
    print('    POST /learn/start   { ip }')
    print('    POST /learn/capture {}')
    print('    POST /test       { ip }')
    print('  ──────────────────────\n')
    app.run(host='127.0.0.1', port=3002, debug=False)
