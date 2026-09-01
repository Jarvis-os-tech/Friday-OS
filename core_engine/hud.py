"""
Native Desktop HUD Overlay for J.A.R.V.I.S. (PySide6 / Glassmorphism HUD).
Builds a transparent, frameless, always-on-top Linux desktop visualizer.
"""

import sys
import os
import math
from typing import Optional

try:
    from PySide6.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QHBoxLayout, QPushButton
    from PySide6.QtCore import Qt, QTimer, QPoint
    from PySide6.QtGui import QPainter, QColor, QRadialGradient, QPen, QFont
    PYSIDE_AVAILABLE = True
except ImportError:
    try:
        from PyQt6.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QHBoxLayout, QPushButton
        from PyQt6.QtCore import Qt, QTimer, QPoint
        from PyQt6.QtGui import QPainter, QColor, QRadialGradient, QPen, QFont
        PYSIDE_AVAILABLE = True
    except ImportError:
        PYSIDE_AVAILABLE = False


if PYSIDE_AVAILABLE:
    class JarvisDesktopHUD(QWidget):
        def __init__(self):
            super().__init__()
            self._init_window()
            self._init_ui()
            self._phase = 0.0
            self._amplitude = 0.4

            # 30 FPS render animation loop
            self.anim_timer = QTimer(self)
            self.anim_timer.timeout.connect(self._animate_orb)
            self.anim_timer.start(33)

        def _init_window(self):
            self.setWindowTitle("J.A.R.V.I.S. Tactical HUD")
            self.setWindowFlags(
                Qt.WindowType.FramelessWindowHint |
                Qt.WindowType.WindowStaysOnTopHint |
                Qt.WindowType.SubWindow
            )
            self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
            self.resize(360, 240)
            
            # Position at bottom-right corner
            screen = QApplication.primaryScreen().geometry()
            self.move(screen.width() - 380, screen.height() - 280)

        def _init_ui(self):
            layout = QVBoxLayout(self)
            layout.setContentsMargins(15, 15, 15, 15)

            # Top Header
            header = QHBoxLayout()
            self.title_label = QLabel("J.A.R.V.I.S. PRIME", self)
            self.title_label.setStyleSheet("color: #38bdf8; font-weight: bold; font-size: 13px; font-family: monospace;")
            header.addWidget(self.title_label)

            header.addStretch()

            self.status_badge = QLabel("TELGISH LIVE", self)
            self.status_badge.setStyleSheet(
                "color: #10b981; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); "
                "padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: bold; font-family: monospace;"
            )
            header.addWidget(self.status_badge)
            layout.addLayout(header)

            layout.addStretch()

            # Bottom Telemetry Bar
            self.telemetry_label = QLabel("Rust 16kHz • Unix Sock • SQLite WAL", self)
            self.telemetry_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.telemetry_label.setStyleSheet("color: #94a3b8; font-size: 10px; font-family: monospace;")
            layout.addWidget(self.telemetry_label)

        def _animate_orb(self):
            self._phase += 0.08
            self.update()

        def set_amplitude(self, amp: float):
            self._amplitude = max(0.1, min(1.0, amp))

        def paintEvent(self, event):
            painter = QPainter(self)
            painter.setRenderHint(QPainter.RenderHint.Antialiasing)

            # Glassmorphism container background
            rect = self.rect()
            bg_color = QColor(15, 23, 42, 210)  # Dark slate with 82% opacity
            border_color = QColor(56, 189, 248, 80)
            painter.setBrush(bg_color)
            painter.setPen(QPen(border_color, 1.5))
            painter.drawRoundedRect(rect.adjusted(1, 1, -1, -1), 16, 16)

            # Center Pulsing Visualizer Orb
            center_x = rect.width() / 2
            center_y = (rect.height() / 2) - 5
            base_radius = 32 + (math.sin(self._phase) * 6 * self._amplitude)

            # Radial Glow
            gradient = QRadialGradient(center_x, center_y, base_radius * 1.8)
            gradient.setColorAt(0.0, QColor(6, 182, 212, 180))
            gradient.setColorAt(0.5, QColor(56, 189, 248, 60))
            gradient.setColorAt(1.0, QColor(6, 182, 212, 0))
            painter.setBrush(gradient)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawEllipse(QPoint(int(center_x), int(center_y)), int(base_radius * 1.8), int(base_radius * 1.8))

            # Core Inner Sphere
            painter.setBrush(QColor(6, 182, 212, 230))
            painter.setPen(QPen(QColor(255, 255, 255, 200), 1.5))
            painter.drawEllipse(QPoint(int(center_x), int(center_y)), int(base_radius * 0.7), int(base_radius * 0.7))


def launch_native_hud():
    """
    Spawns the native desktop HUD if graphical environment and PySide6 are present.
    """
    if not PYSIDE_AVAILABLE:
        print("[HUD] PySide6/PyQt6 not installed. Using Headless Console HUD.")
        return None

    if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
        print("[HUD] No graphical X11/Wayland display found. Running headless.")
        return None

    app = QApplication.instance() or QApplication(sys.argv)
    hud = JarvisDesktopHUD()
    hud.show()
    return hud
