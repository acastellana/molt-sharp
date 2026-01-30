/**
 * Sharp Dashboard - Session Management
 */

import { state } from './state.js';
import { escapeHtml, showToast } from './utils.js';
import { rpcCall } from './websocket.js';

// Render callback - set by app.js
let renderSessions = () => {};
let renderSessionsGrid = () => {};

export function setRenderCallbacks(callbacks) {
  if (callbacks.renderSessions) renderSessions = callbacks.renderSessions;
  if (callbacks.renderSessionsGrid) renderSessionsGrid = callbacks.renderSessionsGrid;
}

// ═══════════════════════════════════════════════════════════════
// SESSION PIN & ARCHIVE
// ═══════════════════════════════════════════════════════════════

export function isSessionPinned(key) {
  return state.pinnedSessions.includes(key);
}

export function isSessionArchived(key) {
  return state.archivedSessions.includes(key);
}

export function togglePinSession(key) {
  const idx = state.pinnedSessions.indexOf(key);
  if (idx >= 0) {
    state.pinnedSessions.splice(idx, 1);
  } else {
    state.pinnedSessions.push(key);
  }
  localStorage.setItem('sharp_pinned_sessions', JSON.stringify(state.pinnedSessions));
  renderSessions();
  renderSessionsGrid();
}

export function toggleArchiveSession(key) {
  const idx = state.archivedSessions.indexOf(key);
  if (idx >= 0) {
    state.archivedSessions.splice(idx, 1);
  } else {
    state.archivedSessions.push(key);
    // Unpin if archived
    const pinIdx = state.pinnedSessions.indexOf(key);
    if (pinIdx >= 0) {
      state.pinnedSessions.splice(pinIdx, 1);
      localStorage.setItem('sharp_pinned_sessions', JSON.stringify(state.pinnedSessions));
    }
  }
  localStorage.setItem('sharp_archived_sessions', JSON.stringify(state.archivedSessions));
  renderSessions();
  renderSessionsGrid();
}

export function toggleShowArchived() {
  state.showArchived = !state.showArchived;
  renderSessions();
}

// ═══════════════════════════════════════════════════════════════
// SESSION GROUPING (for Telegram topics, etc.)
// ═══════════════════════════════════════════════════════════════

export function parseSessionGroup(key) {
  // Match patterns like: agent:main:telegram:group:-1003814943696:topic:54
  const topicMatch = key.match(/^(agent:[^:]+:[^:]+:group:[^:]+):topic:(\d+)$/);
  if (topicMatch) {
    return {
      type: 'topic',
      groupKey: topicMatch[1],
      topicId: topicMatch[2],
      isGrouped: true
    };
  }
  // Match patterns like: agent:main:telegram:group:-1003814943696
  const groupMatch = key.match(/^(agent:[^:]+:[^:]+:group:[^:]+)$/);
  if (groupMatch) {
    return {
      type: 'group',
      groupKey: groupMatch[1],
      isGrouped: false
    };
  }
  return { type: 'standalone', isGrouped: false };
}

export function getGroupDisplayName(groupKey) {
  const customName = state.sessionNames[groupKey];
  if (customName) return customName;
  const match = groupKey.match(/:group:(-?\d+)$/);
  if (match) {
    return `Group ${match[1]}`;
  }
  return groupKey.split(':').pop();
}

export function toggleGroupExpanded(groupKey) {
  state.expandedGroups[groupKey] = !state.expandedGroups[groupKey];
  localStorage.setItem('sharp_expanded_groups', JSON.stringify(state.expandedGroups));
  renderSessions();
}

export function isGroupExpanded(groupKey) {
  return state.expandedGroups[groupKey] !== false;
}

export function getGroupUnreadCount(groupKey, sessions) {
  return sessions.filter(s => {
    const parsed = parseSessionGroup(s.key);
    return parsed.groupKey === groupKey && isSessionUnread(s.key);
  }).length;
}

// ═══════════════════════════════════════════════════════════════
// UNREAD TRACKING
// ═══════════════════════════════════════════════════════════════

export function isSessionUnread(key) {
  const session = state.sessions.find(s => s.key === key);
  if (!session) return false;
  const lastViewed = state.lastViewedAt[key] || 0;
  const updatedAt = session.updatedAt || 0;
  return updatedAt > lastViewed + 1000;
}

export function markSessionRead(key) {
  state.lastViewedAt[key] = Date.now();
  localStorage.setItem('sharp_last_viewed', JSON.stringify(state.lastViewedAt));
}

export function markSessionUnread(key, event) {
  if (event) event.stopPropagation();
  state.lastViewedAt[key] = 0;
  localStorage.setItem('sharp_last_viewed', JSON.stringify(state.lastViewedAt));
  renderSessions();
  renderSessionsGrid();
}

export function markAllSessionsRead() {
  const now = Date.now();
  state.sessions.forEach(s => {
    state.lastViewedAt[s.key] = now;
  });
  localStorage.setItem('sharp_last_viewed', JSON.stringify(state.lastViewedAt));
  renderSessions();
  renderSessionsGrid();
  showToast('All sessions marked as read');
}

export function getUnreadCount() {
  return state.sessions.filter(s => isSessionUnread(s.key)).length;
}

// ═══════════════════════════════════════════════════════════════
// SESSION NAMES
// ═══════════════════════════════════════════════════════════════

export function getCustomSessionName(key) {
  return state.sessionNames[key] || null;
}

export function setCustomSessionName(key, name) {
  if (name && name.trim()) {
    state.sessionNames[key] = name.trim();
  } else {
    delete state.sessionNames[key];
  }
  localStorage.setItem('sharp_session_names', JSON.stringify(state.sessionNames));
  renderSessions();
  renderSessionsGrid();
}

export function getDefaultSessionName(session) {
  if (!session) return 'Unknown';
  return session.displayName || session.label || session.key.split(':').pop() || session.key;
}

export function getSessionName(session) {
  return getCustomSessionName(session.key) || getDefaultSessionName(session);
}

export function promptRenameSession(key, event) {
  if (event) event.stopPropagation();
  const session = state.sessions.find(s => s.key === key);
  const current = getCustomSessionName(key) || getDefaultSessionName(session);
  const newName = prompt('Rename session:', current);
  if (newName !== null) {
    setCustomSessionName(key, newName);
  }
}

// ═══════════════════════════════════════════════════════════════
// TITLE GENERATION (AI)
// ═══════════════════════════════════════════════════════════════

export async function generateSessionTitle(key, event) {
  if (event) event.stopPropagation();
  const session = state.sessions.find(s => s.key === key);
  if (!session) return;
  
  showToast('Generating title...', 'info', 3000);
  
  try {
    const historyResult = await rpcCall('chat.history', { sessionKey: key, limit: 5 });
    const messages = historyResult?.messages || [];
    
    if (messages.length === 0) {
      showToast('No messages to summarize', 'warning');
      return;
    }
    
    const conversation = extractConversation(messages);
    if (!conversation.trim()) {
      showToast('No content to summarize', 'warning');
      return;
    }
    
    const title = await generateTitleWithLLM(conversation);
    
    if (title) {
      setCustomSessionName(key, title);
      showToast(`Titled: "${title}"`, 'success');
    } else {
      showToast('Could not generate title', 'warning');
    }
  } catch (err) {
    console.error('Failed to generate title:', err);
    showToast('Failed to generate title', 'error');
  }
}

export async function generateGroupTitles(groupKey, event) {
  if (event) event.stopPropagation();
  const groupSessions = state.sessions.filter(s => {
    const parsed = parseSessionGroup(s.key);
    return parsed.groupKey === groupKey && parsed.type === 'topic';
  });
  
  showToast(`Generating titles for ${groupSessions.length} topics...`);
  
  for (const s of groupSessions) {
    if (!getCustomSessionName(s.key) && !state.generatingTitles.has(s.key)) {
      await generateSessionTitle(s.key);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

export async function autoGenerateTitle(key) {
  state.attemptedTitles.add(key);
  state.generatingTitles.add(key);
  renderSessions();
  
  try {
    const session = state.sessions.find(s => s.key === key);
    if (!session) return;
    
    const historyResult = await rpcCall('chat.history', { sessionKey: key, limit: 5 });
    const messages = historyResult?.messages || [];
    
    if (messages.length === 0) {
      state.generatingTitles.delete(key);
      renderSessions();
      return;
    }
    
    const conversation = extractConversation(messages);
    if (!conversation.trim()) {
      state.generatingTitles.delete(key);
      renderSessions();
      return;
    }
    
    const title = await generateTitleWithLLM(conversation);
    state.generatingTitles.delete(key);
    
    if (title) {
      setCustomSessionName(key, title);
      animateTitle(key, title);
    } else {
      renderSessions();
    }
  } catch (err) {
    console.error('Auto-generate title failed:', err);
    state.generatingTitles.delete(key);
    renderSessions();
  }
}

function extractConversation(messages) {
  return messages.slice(0, 4).map(m => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    let content = '';
    if (typeof m.content === 'string') {
      content = m.content.slice(0, 150);
    } else if (Array.isArray(m.content)) {
      content = m.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join(' ')
        .slice(0, 150);
    }
    return `${role}: ${content}`;
  }).join('\n');
}

async function generateTitleWithLLM(conversation) {
  try {
    const response = await fetch('/api/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Generate a very short title (3-6 words) for this conversation. Reply with ONLY the title, no quotes, no punctuation at the end.'
          },
          { role: 'user', content: conversation }
        ],
        max_tokens: 20,
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      console.error('OpenAI API error:', response.status);
      return null;
    }
    
    const data = await response.json();
    const title = data.choices?.[0]?.message?.content?.trim();
    
    if (title && title.length < 60) {
      return title.replace(/^["']|["']$/g, '').replace(/\.+$/, '');
    }
    return null;
  } catch (err) {
    console.error('LLM title generation failed:', err);
    return null;
  }
}

function animateTitle(key, title) {
  const el = document.querySelector(`[data-session-key="${key}"] .item-name`);
  if (el) {
    el.innerHTML = '';
    el.className = 'item-name title-typewriter';
    let i = 0;
    const interval = setInterval(() => {
      if (i < title.length) {
        el.textContent += title[i];
        i++;
      } else {
        clearInterval(interval);
        el.className = 'item-name';
      }
    }, 30);
  } else {
    renderSessions();
  }
}

// ═══════════════════════════════════════════════════════════════
// SESSION STATUS BRIEF
// ═══════════════════════════════════════════════════════════════

export function getSessionStatus(key) {
  return state.sessionStatus[key] || null;
}

export async function generateSessionStatusBrief(key, event) {
  if (event) event.stopPropagation();
  if (state.generatingStatus.has(key)) return;
  
  state.generatingStatus.add(key);
  renderSessions();
  
  try {
    const history = await rpcCall('chat.history', { sessionKey: key, limit: 5 });
    if (!history?.messages?.length) {
      state.generatingStatus.delete(key);
      return;
    }
    
    const context = history.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 150) : ''}`)
      .join('\n');
    
    const response = await fetch('/api/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Write a 5-8 word status of what is currently happening. Be specific. No punctuation.' },
          { role: 'user', content: context.slice(0, 1500) }
        ],
        max_tokens: 30,
        temperature: 0.3
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const status = data.choices?.[0]?.message?.content?.trim();
      if (status && status.length < 80) {
        state.sessionStatus[key] = { text: status, updatedAt: Date.now() };
        localStorage.setItem('sharp_session_status', JSON.stringify(state.sessionStatus));
      }
    }
  } catch (err) {
    console.error('Status generation failed:', err);
  } finally {
    state.generatingStatus.delete(key);
    renderSessions();
  }
}

export function renderSessionStatusLine(key) {
  const isGenerating = state.generatingStatus.has(key);
  const status = getSessionStatus(key);
  
  if (isGenerating) {
    return '<div class="item-status generating">⏳</div>';
  }
  
  if (status?.text) {
    return `<div class="item-status" onclick="event.stopPropagation(); window.Sharp.generateSessionStatusBrief('${escapeHtml(key)}')" title="Click to refresh">${escapeHtml(status.text)}</div>`;
  }
  
  return `<div class="item-status generate-link" onclick="event.stopPropagation(); window.Sharp.generateSessionStatusBrief('${escapeHtml(key)}')">↻ status</div>`;
}

// ═══════════════════════════════════════════════════════════════
// SESSION SEARCH
// ═══════════════════════════════════════════════════════════════

export function handleSearchInput(value) {
  state.searchQuery = value.toLowerCase().trim();
  renderSessions();
}

export function clearSearch() {
  state.searchQuery = '';
  const input = document.getElementById('sessionSearchInput');
  if (input) input.value = '';
  renderSessions();
}

export function handleSearchKeydown(event) {
  if (event.key === 'Escape') {
    clearSearch();
    document.getElementById('sessionSearchInput')?.blur();
  } else if (event.key === 'Enter') {
    const firstSession = document.querySelector('#sessionsList .item');
    if (firstSession) firstSession.click();
  }
}

export function matchesSearch(session) {
  if (!state.searchQuery) return true;
  const q = state.searchQuery;
  const name = getSessionName(session).toLowerCase();
  const key = session.key.toLowerCase();
  const label = (session.label || '').toLowerCase();
  const displayName = (session.displayName || '').toLowerCase();
  return name.includes(q) || key.includes(q) || label.includes(q) || displayName.includes(q);
}

// ═══════════════════════════════════════════════════════════════
// AUTO-ARCHIVE
// ═══════════════════════════════════════════════════════════════

export function setAutoArchiveDays(value) {
  state.autoArchiveDays = value;
  localStorage.setItem('sharp_auto_archive_days', value);
  console.log('[Sharp] Auto-archive set to:', value);
}

export function initAutoArchiveUI() {
  const select = document.getElementById('autoArchiveSelect');
  if (select) {
    select.value = state.autoArchiveDays;
  }
}

export function checkAutoArchive() {
  if (state.autoArchiveDays === 'never') {
    console.log('[Sharp] Auto-archive disabled');
    return;
  }
  
  const days = parseFloat(state.autoArchiveDays);
  if (isNaN(days) || days <= 0) return;
  
  const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
  let autoArchivedCount = 0;
  
  for (const session of state.sessions) {
    if (isSessionArchived(session.key)) continue;
    if (isSessionPinned(session.key)) continue;
    
    const updatedAt = session.updatedAt || 0;
    if (updatedAt > 0 && updatedAt < threshold) {
      state.archivedSessions.push(session.key);
      autoArchivedCount++;
      console.log('[Sharp] Auto-archived:', session.key);
    }
  }
  
  if (autoArchivedCount > 0) {
    localStorage.setItem('sharp_archived_sessions', JSON.stringify(state.archivedSessions));
    showToast(`Auto-archived ${autoArchivedCount} inactive session${autoArchivedCount > 1 ? 's' : ''}`);
    renderSessions();
    renderSessionsGrid();
  }
}
