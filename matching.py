from geopy.distance import geodesic
from sqlalchemy.orm import Session
from models import User
import random

class MatchMaker:
    def __init__(self):
        self.waiting_users = []
    
    def add_waiting_user(self, user_id: int, gender: str, age: int, lat: float, lng: float):
        """Добавить пользователя в очередь поиска"""
        user_data = {
            'user_id': user_id,
            'gender': gender,
            'age': age,
            'location': (lat, lng),
            'timestamp': None
        }
        self.waiting_users.append(user_data)
    
    def remove_waiting_user(self, user_id: int):
        """Удалить пользователя из очереди"""
        self.waiting_users = [u for u in self.waiting_users if u['user_id'] != user_id]
    
    def find_match(self, current_user_id: int, db: Session):
        """Найти подходящего собеседника"""
        current_user_data = next((u for u in self.waiting_users if u['user_id'] == current_user_id), None)
        if not current_user_data:
            return None
        
        current_user = db.query(User).filter(User.id == current_user_id).first()
        if not current_user:
            return None
        
        # Фильтруем подходящих кандидатов
        candidates = []
        for candidate in self.waiting_users:
            if candidate['user_id'] == current_user_id:
                continue
            
            candidate_user = db.query(User).filter(User.id == candidate['user_id']).first()
            if not candidate_user:
                continue
            
            # Проверяем противоположный пол
            if candidate['gender'] == current_user_data['gender']:
                continue
            
            # Проверяем разницу в возрасте (максимум 5 лет)
            age_diff = abs(candidate['age'] - current_user_data['age'])
            if age_diff > 5:
                continue
            
            # Рассчитываем расстояние
            distance = geodesic(current_user_data['location'], candidate['location']).kilometers
            
            candidates.append({
                'user_id': candidate['user_id'],
                'distance': distance,
                'age_diff': age_diff
            })
        
        if not candidates:
            return None
        
        # Сортируем по расстоянию и разнице в возрасте
        candidates.sort(key=lambda x: (x['distance'], x['age_diff']))
        
        # Возвращаем лучшего кандидата
        return candidates[0]['user_id']