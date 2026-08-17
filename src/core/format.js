function progressBar(current, maximum, width = 10) {
  const safeMaximum = Math.max(1, maximum);
  const filled = Math.max(0, Math.min(width, Math.round(current / safeMaximum * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function duration(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.ceil((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

module.exports = { progressBar, duration };
