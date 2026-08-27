"use client";

import Link from "next/link";
import { useId, type FormEvent } from "react";
import { AlertCircle, LoaderCircle, MessageCircle, RefreshCw, Send } from "lucide-react";
import { MediaLightbox } from "@/components/MediaLightbox";
import { UserAvatar } from "@/components/UserAvatar";
import { CONTENT_LIMITS } from "@/lib/content-limits";
import type { CommentActor } from "@/lib/models";
import { useI18n } from "@/i18n/I18nProvider";

export type CommentListUser = CommentActor & {
  profileHref?: string;
};

export type PostCommentViewModel = {
  id: string;
  body: string;
  user: CommentListUser;
  createdAt?: string;
  createdAtLabel: string;
  status?: "sent" | "pending" | "failed";
};

export type PostCommentsDialogProps = {
  open: boolean;
  onClose: () => void;
  comments: PostCommentViewModel[];
  total: number;
  currentUser: CommentListUser;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (body: string) => void | Promise<void>;
  loading?: boolean;
  error?: string;
  onRetry?: () => void | Promise<void>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
  submitting?: boolean;
  submitError?: string;
  onRetryComment?: (comment: PostCommentViewModel) => void | Promise<void>;
  profilePrefix?: string;
  dialogId?: string;
};

function profileHref(user: CommentListUser, profilePrefix: string) {
  return user.profileHref ?? `${profilePrefix}/${encodeURIComponent(user.username)}`;
}

export function PostCommentsDialog({
  open,
  onClose,
  comments,
  total,
  currentUser,
  draft,
  onDraftChange,
  onSubmit,
  loading = false,
  error = "",
  onRetry,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  submitting = false,
  submitError = "",
  onRetryComment,
  profilePrefix = "/users",
  dialogId,
}: PostCommentsDialogProps) {
  const { dictionary: copy } = useI18n();
  const draftId = useId();
  const counterId = useId();
  const submitErrorId = useId();
  const trimmedDraft = draft.trim();
  const canSubmit = trimmedDraft.length >= CONTENT_LIMITS.commentBody.min && draft.length <= CONTENT_LIMITS.commentBody.max && !submitting;

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    void onSubmit(trimmedDraft);
  }

  return (
    <MediaLightbox open={open} onClose={onClose} title={`${copy.social.comments} · ${total}`} className="post-comments-dialog" closeLabel={copy.social.commentsPanelClose} dialogId={dialogId}>
      <div className="post-comments-layout">
        <div className="post-comments-scroll" aria-busy={loading || loadingMore}>
          {loading && comments.length === 0 ? (
            <div className="post-comments-state" role="status">
              <LoaderCircle className="post-comments-spinner" size={26} aria-hidden="true" />
              <strong>{copy.social.commentsLoading}</strong>
              <span>{copy.social.conversationPreparing}</span>
            </div>
          ) : error && comments.length === 0 ? (
            <div className="post-comments-state is-error" role="alert">
              <AlertCircle size={27} aria-hidden="true" />
              <strong>{copy.social.commentsLoadFailed}</strong>
              <span>{error}</span>
              {onRetry ? <button type="button" className="post-comments-retry" onClick={() => void onRetry()}><RefreshCw size={15} aria-hidden="true" /> {copy.common.retry}</button> : null}
            </div>
          ) : comments.length === 0 ? (
            <div className="post-comments-state is-empty">
              <MessageCircle size={28} aria-hidden="true" />
              <strong>{copy.social.noComments}</strong>
              <span>{copy.social.firstCommentHint}</span>
            </div>
          ) : (
            <>
              {error ? (
                <div className="post-comments-inline-error" role="alert">
                  <span>{error}</span>
                  {onRetry ? <button type="button" onClick={() => void onRetry()}>{copy.common.retry}</button> : null}
                </div>
              ) : null}
              <ol className="post-comments-list" aria-live="polite" aria-relevant="additions text">
                {comments.map((comment) => {
                  const href = profileHref(comment.user, profilePrefix);
                  const status = comment.status ?? "sent";
                  return (
                    <li className={`post-comment${status !== "sent" ? ` is-${status}` : ""}`} key={comment.id}>
                      <UserAvatar user={comment.user} size="sm" href={href} />
                      <div className="post-comment-content">
                        <div className="post-comment-heading">
                          <Link href={href}><strong>{comment.user.displayName}</strong><span>@{comment.user.username}</span></Link>
                          <time dateTime={comment.createdAt}>{comment.createdAtLabel}</time>
                        </div>
                        <p>{comment.body}</p>
                        {status === "pending" ? <small className="post-comment-status" role="status"><LoaderCircle className="post-comments-spinner" size={13} aria-hidden="true" /> {copy.social.sending}</small> : null}
                        {status === "failed" ? (
                          <small className="post-comment-status is-error" role="alert">
                            {copy.social.sendFailed}
                            {onRetryComment ? <button type="button" onClick={() => void onRetryComment(comment)}>{copy.social.retry}</button> : null}
                          </small>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {hasMore && onLoadMore ? (
                <button type="button" className="post-comments-load-more" onClick={() => void onLoadMore()} disabled={loadingMore}>
                  {loadingMore ? <><LoaderCircle className="post-comments-spinner" size={15} aria-hidden="true" /> {copy.social.loading}</> : copy.social.showMoreComments}
                </button>
              ) : null}
            </>
          )}
        </div>

        <form className="post-comments-composer" onSubmit={submitComment} aria-busy={submitting}>
          <UserAvatar user={currentUser} size="sm" href={profileHref(currentUser, profilePrefix)} />
          <div className="post-comments-composer-field">
            <label className="visually-hidden" htmlFor={draftId}>{copy.social.yourComment}</label>
            <textarea
              id={draftId}
              aria-describedby={`${counterId}${submitError ? ` ${submitErrorId}` : ""}`}
              placeholder={copy.social.commentPlaceholder}
              value={draft}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
              maxLength={CONTENT_LIMITS.commentBody.max}
              rows={2}
              disabled={submitting}
            />
            <span id={counterId} className="post-comments-counter">{draft.length}/{CONTENT_LIMITS.commentBody.max}</span>
            {submitError ? <span id={submitErrorId} className="post-comments-submit-error" role="alert">{submitError}</span> : null}
          </div>
          <button type="submit" className="post-comments-submit" disabled={!canSubmit} aria-label={submitting ? copy.social.commentSendingAria : copy.social.sendCommentAria}>
            {submitting ? <LoaderCircle className="post-comments-spinner" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
          </button>
        </form>
      </div>
    </MediaLightbox>
  );
}
