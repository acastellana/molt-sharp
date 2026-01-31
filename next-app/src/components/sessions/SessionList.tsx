'use client';

/**
 * SessionList Component
 * Displays a list of agent sessions with real-time updates
 */

import { useState, useEffect, useCallback } from 'react';
import { SessionCard } from './SessionCard';
import { useGateway } from '@/hooks/use-gateway';
import type { Session, SessionKey, ChatEvent, AgentEvent } from '@/lib/types';

type SessionListProps = {
  onSessionSelect?: (sessionKey: SessionKey) => void;
  selectedSession?: SessionKey | null;
};

export function SessionList({ 
  onSessionSelect, 
  selectedSession: _selectedSession 
}: SessionListProps): React.ReactElement {
  const { isConnected, listSessions, subscribe, gateway, abort } = useGateway();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeRuns, setActiveRuns] = useState<Set<SessionKey>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch sessions from gateway
   */
  const fetchSessions = useCallback(async (): Promise<void> => {
    if (!isConnected) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const [sessionsResult, runsResult] = await Promise.all([
        listSessions(100),
        gateway?.getActiveRuns() ?? { runs: [] },
      ]);
      
      setSessions(sessionsResult.sessions);
      setActiveRuns(new Set(runsResult.runs.map((r) => r.sessionKey)));
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, listSessions, gateway]);

  // Fetch sessions on connect
  useEffect(() => {
    if (isConnected) {
      fetchSessions();
    }
  }, [isConnected, fetchSessions]);

  // Subscribe to real-time events
  useEffect(() => {
    if (!isConnected) return;

    // Handle chat events (new messages, streaming)
    const unsubChat = subscribe('chat', (event: ChatEvent) => {
      if (event.type === 'start') {
        // Mark session as active
        setActiveRuns((prev) => new Set([...prev, event.sessionKey]));
      } else if (event.type === 'done' || event.type === 'error' || event.type === 'abort') {
        // Mark session as idle
        setActiveRuns((prev) => {
          const next = new Set(prev);
          next.delete(event.sessionKey);
          return next;
        });
        // Refresh sessions to get updated message counts
        fetchSessions();
      }
    });

    // Handle agent events (start/stop)
    const unsubAgent = subscribe('agent', (event: AgentEvent) => {
      if (event.type === 'start') {
        setActiveRuns((prev) => new Set([...prev, event.sessionKey]));
      } else if (event.type === 'stop' || event.type === 'error') {
        setActiveRuns((prev) => {
          const next = new Set(prev);
          next.delete(event.sessionKey);
          return next;
        });
      }
    });

    return () => {
      unsubChat();
      unsubAgent();
    };
  }, [isConnected, subscribe, fetchSessions]);

  // Parse session key to get channel type
  const getSessionChannel = (key: SessionKey): string => {
    const parts = key.split(':');
    return parts[2] || 'unknown';
  };

  // Check if session is a subagent
  const isSubagent = (key: SessionKey): boolean => {
    return getSessionChannel(key) === 'subagent';
  };

  // Sort sessions: active first, then by last message time
  // But keep subagents grouped after their potential parents
  const sortedSessions = [...sessions].sort((a, b) => {
    const aActive = activeRuns.has(a.key);
    const bActive = activeRuns.has(b.key);
    const aSubagent = isSubagent(a.key);
    const bSubagent = isSubagent(b.key);
    
    // Active sessions first (but subagents stay with parents)
    if (aActive && !bActive && !aSubagent && !bSubagent) return -1;
    if (!aActive && bActive && !aSubagent && !bSubagent) return 1;
    
    // Then by last message time
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });

  // Build tree structure: group subagents under parent sessions
  type SessionNode = {
    session: Session;
    children: Session[];
  };

  const buildSessionTree = (): SessionNode[] => {
    const mainSessions: SessionNode[] = [];
    const subagentSessions: Session[] = [];
    
    // Separate main sessions and subagents
    for (const session of sortedSessions) {
      if (isSubagent(session.key)) {
        subagentSessions.push(session);
      } else {
        mainSessions.push({ session, children: [] });
      }
    }
    
    // Try to match subagents to parents by timing
    // A subagent likely belongs to the most recent active parent session
    for (const subagent of subagentSessions) {
      const subagentTime = subagent.createdAt ? new Date(subagent.createdAt).getTime() : 0;
      
      // Find the best parent: most recent session that was active before this subagent
      let bestParent: SessionNode | null = null;
      let bestTimeDiff = Infinity;
      
      for (const node of mainSessions) {
        const parentTime = node.session.lastMessageAt 
          ? new Date(node.session.lastMessageAt).getTime() 
          : new Date(node.session.createdAt).getTime();
        
        // Parent should have been active around or before subagent was created
        const timeDiff = subagentTime - parentTime;
        if (timeDiff >= -60000 && timeDiff < bestTimeDiff) { // Within 1 minute before
          bestTimeDiff = timeDiff;
          bestParent = node;
        }
      }
      
      if (bestParent) {
        bestParent.children.push(subagent);
      } else if (mainSessions.length > 0) {
        // Fallback: attach to first main session
        mainSessions[0].children.push(subagent);
      } else {
        // No parent found, create a virtual parent
        mainSessions.push({ 
          session: subagent, 
          children: [] 
        });
      }
    }
    
    return mainSessions;
  };

  const sessionTree = buildSessionTree();

  // Loading state
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-[var(--text-dim)]">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-medium">Connecting to gateway...</div>
      </div>
    );
  }

  if (isLoading && sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-[var(--text-dim)]">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-medium">Loading sessions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6">
        <div className="text-5xl mb-4 opacity-40">⚠️</div>
        <div className="font-medium text-[var(--red)] mb-1">Error loading sessions</div>
        <div className="text-sm text-[var(--text-muted)] mb-4">{error}</div>
        <button
          onClick={fetchSessions}
          className="text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (sortedSessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-[var(--text-dim)]">
        <div className="text-5xl mb-4 opacity-40">🤖</div>
        <div className="font-medium mb-1">No sessions yet</div>
        <div className="text-sm text-[var(--text-muted)]">
          Start a conversation to create a session
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {/* Stats header */}
      <div className="px-4 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] flex items-center gap-4 text-xs text-[var(--text-dim)]">
        <span>{sortedSessions.length} session{sortedSessions.length !== 1 ? 's' : ''}</span>
        {activeRuns.size > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
            {activeRuns.size} active
          </span>
        )}
        <button
          onClick={fetchSessions}
          className="ml-auto hover:text-[var(--text-secondary)] transition-colors"
          title="Refresh sessions"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Session cards with tree structure */}
      {sessionTree.map((node) => (
        <div key={node.session.key}>
          {/* Parent session */}
          <SessionCard
            session={node.session}
            isActive={activeRuns.has(node.session.key)}
            onClick={onSessionSelect}
            onAbort={abort}
          />
          
          {/* Child sessions (subagents) */}
          {node.children.length > 0 && (
            <div className="relative">
              {node.children.map((child, index) => (
                <div key={child.key} className="relative">
                  {/* Tree connector */}
                  <div className="absolute left-4 top-0 bottom-0 flex items-start pointer-events-none">
                    {/* Vertical line */}
                    <div 
                      className={`
                        w-px bg-[var(--border-subtle)]
                        ${index === node.children.length - 1 ? 'h-6' : 'h-full'}
                      `}
                    />
                    {/* Horizontal arrow */}
                    <div className="flex items-center h-6">
                      <div className="w-3 h-px bg-[var(--border-subtle)]" />
                      <span className="text-[var(--text-muted)] text-xs ml-0.5">↳</span>
                    </div>
                  </div>
                  
                  {/* Indented child card */}
                  <div className="ml-8">
                    <SessionCard
                      session={child}
                      isActive={activeRuns.has(child.key)}
                      onClick={onSessionSelect}
                      onAbort={abort}
                      isChild
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default SessionList;
