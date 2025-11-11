import React, { useState, useEffect, useRef } from 'react';
import './NotificationPanel.css';

interface Notification {
  _id: string;
  type: 'deadline_reminder' | 'deadline_missed' | 'goal_completed';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  goalId?: {
    _id: string;
    title: string;
    deadline: string;
  };
}

const NotificationPanel: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Request browser notification permission
  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      try {
        console.log('Current notification permission:', Notification.permission);
        
        // If already denied, show instructions
        if (Notification.permission === 'denied') {
          alert('Notifications are blocked. To enable:\n\n1. Click the lock icon (🔒) or site settings icon in your browser address bar\n2. Find "Notifications" setting\n3. Change from "Block" to "Allow"\n4. Refresh the page and try again');
          return;
        }
        
        const permission = await Notification.requestPermission();
        console.log('New notification permission:', permission);
        setHasPermission(permission === 'granted');
        
        if (permission === 'granted') {
          alert('✅ Notifications enabled successfully! You will now receive deadline reminders.');
        } else if (permission === 'denied') {
          alert('❌ Notification permission denied. To enable:\n\n1. Click the lock icon (🔒) in your browser address bar\n2. Find "Notifications" setting\n3. Change from "Block" to "Allow"\n4. Refresh the page and try again');
        }
      } catch (error) {
        console.error('Error requesting notification permission:', error);
        alert('Failed to request notification permission. Please try again.');
      }
    } else {
      alert('Your browser does not support notifications.');
    }
  };

  // Show browser notification
  const showBrowserNotification = (notification: Notification) => {
    if (hasPermission && 'Notification' in window) {
      const options = {
        body: notification.message,
        icon: '/logo.png',
        badge: '/logo.png',
        tag: notification._id,
        requireInteraction: notification.type === 'deadline_reminder',
      };

      const browserNotif = new Notification(notification.title, options);

      browserNotif.onclick = () => {
        window.focus();
        setIsOpen(true);
        browserNotif.close();
      };
    }
  };

  // Fetch notifications
  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:5050/api/notifications', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        
        // Check for new unread notifications and show browser notifications
        if (notifications.length > 0) {
          const newNotifications = data.filter(
            (notif: Notification) => 
              !notif.read && 
              !notifications.some(n => n._id === notif._id)
          );
          
          newNotifications.forEach((notif: Notification) => {
            showBrowserNotification(notif);
          });
        }
        
        setNotifications(data);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  // Fetch unread count
  const fetchUnreadCount = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:5050/api/notifications/unread-count', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.count);
      }
    } catch (error) {
      console.error('Error fetching unread count:', error);
    }
  };

  // Mark notification as read
  const markAsRead = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:5050/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setNotifications(notifications.map(n => 
          n._id === id ? { ...n, read: true } : n
        ));
        setUnreadCount(Math.max(0, unreadCount - 1));
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:5050/api/notifications/mark-all-read', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setNotifications(notifications.map(n => ({ ...n, read: true })));
        setUnreadCount(0);
      }
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  // Delete notification
  const deleteNotification = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:5050/api/notifications/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const notification = notifications.find(n => n._id === id);
        setNotifications(notifications.filter(n => n._id !== id));
        if (notification && !notification.read) {
          setUnreadCount(Math.max(0, unreadCount - 1));
        }
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  // Format time ago
  const timeAgo = (date: string) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  // Get notification icon based on type
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'deadline_reminder':
        return '⏰';
      case 'deadline_missed':
        return '⚠️';
      case 'goal_completed':
        return '🎉';
      default:
        return '📌';
    }
  };

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Fetch notifications and unread count on mount and poll every 30 seconds
  useEffect(() => {
    // Check permission status on mount
    if ('Notification' in window) {
      setHasPermission(Notification.permission === 'granted');
    }
    
    fetchNotifications();
    fetchUnreadCount();

    const interval = setInterval(() => {
      fetchUnreadCount();
      if (isOpen) {
        fetchNotifications();
      }
    }, 30000); // Poll every 30 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch notifications when panel opens
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div className="notification-panel" ref={panelRef}>
      <button 
        className="notification-bell cursor-target" 
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notifications"
      >
        <span className="bell-icon">🔔</span>
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown">
          <div className="notification-header">
            <h3>Notifications</h3>
            {unreadCount > 0 && (
              <button 
                className="mark-all-read-btn" 
                onClick={markAllAsRead}
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="no-notifications">
                <span className="no-notif-icon">📭</span>
                <p>No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div 
                  key={notification._id} 
                  className={`notification-item ${!notification.read ? 'unread' : ''}`}
                  onClick={() => !notification.read && markAsRead(notification._id)}
                >
                  <div className="notification-icon">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="notification-content">
                    <h4>{notification.title}</h4>
                    <p>{notification.message}</p>
                    {notification.goalId && (
                      <span className="goal-title">📍 {notification.goalId.title}</span>
                    )}
                    <span className="notification-time">{timeAgo(notification.createdAt)}</span>
                  </div>
                  <button 
                    className="delete-notification-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotification(notification._id);
                    }}
                    aria-label="Delete notification"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          {!hasPermission && 'Notification' in window && (
            <div className="notification-permission-banner">
              <p>Enable browser notifications to stay updated</p>
              <button 
                className="cursor-target"
                onClick={requestNotificationPermission}
                type="button"
              >
                Enable
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationPanel;
