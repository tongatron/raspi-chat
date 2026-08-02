'use strict';

// Host metrics for the admin console: CPU temperature and disk usage.
//
// Everything here is best-effort and Raspberry-Pi-first: `vcgencmd` exists only
// on Raspberry Pi OS, the thermal zone only on Linux. On any other host the
// readings come back null and the console simply hides them.

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function readCommand(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 2000 }).trim();
  } catch {
    return null;
  }
}

function readTemperatureC() {
  const vcgencmd = readCommand('vcgencmd', ['measure_temp']);
  if (vcgencmd) {
    const match = vcgencmd.match(/temp=([\d.]+)/i);
    if (match) return Number(match[1]);
  }

  try {
    const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
    if (raw) return Number(raw) / 1000;
  } catch {}

  return null;
}

function readDiskUsage(targetPath) {
  try {
    const stats = fs.statfsSync(targetPath);
    const total = Number(stats.bsize) * Number(stats.blocks);
    const free = Number(stats.bsize) * Number(stats.bavail);
    const used = Math.max(total - free, 0);
    return { total, used, free };
  } catch {
    return null;
  }
}

module.exports = { readDiskUsage, readTemperatureC };
