# turn_server.py
import subprocess
import os
import signal
import sys

def start_turn_server():
    """Запуск локального TURN сервера"""
    turn_config = """
    listening-port=3478
    tls-listening-port=5349
    listening-ip=0.0.0.0
    relay-ip=0.0.0.0
    external-ip=ВАШ_ПУБЛИЧНЫЙ_IP
    realm=your-realm.com
    user=username:password
    user=another:anotherpassword
    lt-cred-mech
    verbose
    no-tls
    no-dtls
    no-cli
    """
    
    # Создаем конфиг
    with open('turnserver.conf', 'w') as f:
        f.write(turn_config)
    
    print("🚀 Запуск TURN сервера...")
    print("📡 Используйте публичный IP: ВАШ_ПУБЛИЧНЫЙ_IP")
    
    # Запускаем coturn (должен быть установлен)
    try:
        process = subprocess.Popen([
            'turnserver', 
            '-c', 'turnserver.conf',
            '--no-stdout-log'
        ])
        
        print(f"✅ TURN сервер запущен с PID: {process.pid}")
        print("🔧 Конфигурация WebRTC для клиентов:")
        print("\nДобавьте в app.js:")
        print('''
        {
            urls: 'turn:ВАШ_ПУБЛИЧНЫЙ_IP:3478',
            username: 'username',
            credential: 'password'
        }
        ''')
        
        # Ожидаем завершения
        process.wait()
        
    except FileNotFoundError:
        print("❌ Coturn не установлен!")
        print("📦 Установите: sudo apt-get install coturn")
        print("💡 Или используйте публичные TURN серверы:")
        print("- https://numb.viagenie.ca")
        print("- https://www.metered.ca/tools/openrelay/")

if __name__ == '__main__':
    start_turn_server()