interface ConflictNoticeProps {
  /** Opens the conflict dialog; omitted while the other version can't be shown. */
  onResolve?: () => void;
}

/** Bar above the editor while the open note is in conflict with another device's save. */
export function ConflictNotice({ onResolve }: ConflictNoticeProps) {
  return (
    <div className="conflict-notice" role="status">
      <svg className="conflict-notice-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 1.8 14.6 13.5H1.4L8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M8 6.2v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r="0.8" fill="currentColor" />
      </svg>
      <span className="conflict-notice-text">
        This note was changed on another device. Your text is kept here but hasn&rsquo;t been saved.
      </span>
      {onResolve && (
        <button className="conflict-notice-btn" onClick={onResolve}>
          Compare and resolve
        </button>
      )}
    </div>
  );
}
