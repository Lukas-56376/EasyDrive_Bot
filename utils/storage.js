const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(filename, defaultValue = {}) {
  ensureDataDir();
  const file = path.join(DATA_DIR, filename);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function saveJSON(filename, data) {
  ensureDataDir();
  const file = path.join(DATA_DIR, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  getEmbedMessages: () => loadJSON('embedMessages.json', {}),
  setEmbedMessage: (key, messageId) => {
    const data = loadJSON('embedMessages.json', {});
    data[key] = messageId;
    saveJSON('embedMessages.json', data);
  },

  // Custom JSON overrides { key: jsonObject }
  getCustomEmbeds: () => loadJSON('customEmbeds.json', {}),
  setCustomEmbed: (key, json) => {
    const data = loadJSON('customEmbeds.json', {});
    data[key] = json;
    saveJSON('customEmbeds.json', data);
  },

  getHours: () => loadJSON('hours.json', {}),
  setHours: (userId, hours) => {
    const data = loadJSON('hours.json', {});
    data[userId] = hours;
    saveJSON('hours.json', data);
  },
  addHours: (userId, amount) => {
    const data = loadJSON('hours.json', {});
    data[userId] = (data[userId] || 0) + amount;
    saveJSON('hours.json', data);
    return data[userId];
  },

  getApplications: () => loadJSON('applications.json', {}),
  setApplication: (userId, app) => {
    const data = loadJSON('applications.json', {});
    data[userId] = app;
    saveJSON('applications.json', data);
  },
  removeApplication: (userId) => {
    const data = loadJSON('applications.json', {});
    delete data[userId];
    saveJSON('applications.json', data);
  },

  getTheorySessions: () => loadJSON('theorySessions.json', {}),
  setTheorySession: (userId, session) => {
    const data = loadJSON('theorySessions.json', {});
    data[userId] = session;
    saveJSON('theorySessions.json', data);
  },
  removeTheorySession: (userId) => {
    const data = loadJSON('theorySessions.json', {});
    delete data[userId];
    saveJSON('theorySessions.json', data);
  },

  getTheoryReviews: () => loadJSON('theoryReviews.json', {}),
  setTheoryReview: (id, review) => {
    const data = loadJSON('theoryReviews.json', {});
    data[id] = review;
    saveJSON('theoryReviews.json', data);
  },
  removeTheoryReview: (id) => {
    const data = loadJSON('theoryReviews.json', {});
    delete data[id];
    saveJSON('theoryReviews.json', data);
  },

  getLessonRequests: () => loadJSON('lessonRequests.json', {}),
  setLessonRequest: (id, req) => {
    const data = loadJSON('lessonRequests.json', {});
    data[id] = req;
    saveJSON('lessonRequests.json', data);
  },
  removeLessonRequest: (id) => {
    const data = loadJSON('lessonRequests.json', {});
    delete data[id];
    saveJSON('lessonRequests.json', data);
  },

  getTheoryTimers: () => loadJSON('theoryTimers.json', {}),
  setTheoryTimer: (userId, ts) => {
    const data = loadJSON('theoryTimers.json', {});
    data[userId] = ts;
    saveJSON('theoryTimers.json', data);
  },

  // Abmeldungen { id: { userId, reason, start, end, status, messageId } }
  getAbsences: () => loadJSON('absences.json', {}),
  setAbsence: (id, data) => {
    const all = loadJSON('absences.json', {});
    all[id] = data;
    saveJSON('absences.json', all);
  },
  removeAbsence: (id) => {
    const all = loadJSON('absences.json', {});
    delete all[id];
    saveJSON('absences.json', all);
  },
};
