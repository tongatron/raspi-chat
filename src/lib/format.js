'use strict';

// Presentation helpers shared by the status endpoint and the admin console.

// Human-readable uptime, e.g. "3d 4h 12m". Anything below a minute reads "0m"
// rather than showing seconds, which is the resolution the console displays.
function formatUptimeSeconds(totalSeconds) {
  const value = Math.max(Math.floor(totalSeconds || 0), 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

module.exports = { formatUptimeSeconds };
