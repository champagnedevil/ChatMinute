from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base
import uuid

def generate_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    first_name = Column(String(50), nullable=False)
    last_name = Column(String(50), nullable=False)
    age = Column(Integer, nullable=False)
    gender = Column(String(10), nullable=False)  # 'male', 'female', 'other'
    bio = Column(Text)
    interests = Column(Text)  # JSON строка с интересами
    location_lat = Column(Float, default=55.7558)
    location_lng = Column(Float, default=37.6173)
    is_online = Column(Boolean, default=False)
    last_seen = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

class MatchSession(Base):
    __tablename__ = "match_sessions"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user1_id = Column(Integer, ForeignKey('users.id'), index=True)
    user2_id = Column(Integer, ForeignKey('users.id'), index=True)
    room_id = Column(String(50), unique=True, index=True)
    started_at = Column(DateTime, default=func.now())
    user1_approval = Column(Boolean, default=None)
    user2_approval = Column(Boolean, default=None)
    is_matched = Column(Boolean, default=False)
    ended_at = Column(DateTime, nullable=True)
    
    user1 = relationship("User", foreign_keys=[user1_id])
    user2 = relationship("User", foreign_keys=[user2_id])

class Connection(Base):
    __tablename__ = "connections"
    
    id = Column(Integer, primary_key=True, index=True)
    user1_id = Column(Integer, ForeignKey('users.id'), index=True)
    user2_id = Column(Integer, ForeignKey('users.id'), index=True)
    matched_at = Column(DateTime, default=func.now())
    is_active = Column(Boolean, default=True)

class UserSession(Base):
    __tablename__ = "user_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), index=True)
    session_token = Column(String(255), unique=True, index=True)
    created_at = Column(DateTime, default=func.now())
    expires_at = Column(DateTime)
    is_active = Column(Boolean, default=True)