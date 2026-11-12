const QRCode = require('qrcode');

class QRCodeService {
  /**
   * Generate QR Code as DataURL (base64 PNG) for a room quick report link
   */
  static async generateRoomQR(baseUrl, roomCode, roomId) {
    const reportUrl = `${baseUrl}/lapor.html?room=${encodeURIComponent(roomCode)}&id=${roomId}`;
    return await QRCode.toDataURL(reportUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 300,
      color: {
        dark: '#0369a1', // RSUD Labuha primary blue
        light: '#ffffff'
      }
    });
  }

  /**
   * Generate QR Code for tracking a specific ticket
   */
  static async generateTicketQR(baseUrl, ticketNo) {
    const trackUrl = `${baseUrl}/track.html?ticket=${encodeURIComponent(ticketNo)}`;
    return await QRCode.toDataURL(trackUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 250,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
  }
}

module.exports = QRCodeService;

