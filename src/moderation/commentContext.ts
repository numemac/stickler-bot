import { type RedditAPIClient } from "@devvit/public-api";

import { MAX_CONTENT_CHARS } from "../constants.js";
import { sanitizeUntrustedText } from "../text.js";

const MAX_COMMENT_CONTEXT_ANCESTORS_TO_FETCH = 24;
const MAX_COMMENT_CONTEXT_ANCESTORS_IN_PROMPT = 8;
const MAX_TARGET_COMMENT_CONTEXT_CHARS = 900;
const MAX_ANCESTOR_COMMENT_CONTEXT_CHARS = 320;
const MAX_POST_CONTEXT_TITLE_CHARS = 220;
const MAX_POST_CONTEXT_BODY_CHARS = 700;
const MAX_POST_CONTEXT_URL_CHARS = 320;

export type PromptContextComment = {
  id: string;
  parentId: string;
  postId: string;
  authorId?: string;
  authorName: string;
  body: string;
};

type PromptContextPost = {
  id: string;
  authorId?: string;
  authorName: string;
  title: string;
  body?: string;
  url: string;
};

type AncestorContextEntry = {
  comment: PromptContextComment;
  distanceFromTarget: number;
};

/**
 * Builds structured prompt context for a reported comment, including parent
 * chain and top-level post context.
 */
export async function buildCommentContextForPrompt(
  reddit: RedditAPIClient,
  targetComment: PromptContextComment
): Promise<string> {
  const { ancestorsClosestFirst, truncatedByFetchLimit } =
    await fetchCommentAncestors(reddit, targetComment);

  const ancestorsOldestToNewest = [...ancestorsClosestFirst]
    .reverse()
    .map((ancestor, index, allAncestors) => ({
      comment: ancestor,
      distanceFromTarget: allAncestors.length - index,
    }));

  const { selectedAncestors, omittedAncestorCount } = selectAncestorsForPrompt(
    ancestorsOldestToNewest
  );

  let postContext: PromptContextPost | null = null;
  try {
    const post = await reddit.getPostById(targetComment.postId);
    postContext = toPromptContextPost(post);
  } catch (error) {
    console.warn(
      `Could not fetch post context ${targetComment.postId} while building comment context for ${targetComment.id}`,
      error
    );
  }

  const getParticipantLabel = createParticipantLabeler();

  if (postContext != null) {
    getParticipantLabel(postContext.authorId, postContext.authorName, postContext.id);
  }
  for (const ancestor of selectedAncestors) {
    getParticipantLabel(
      ancestor.comment.authorId,
      ancestor.comment.authorName,
      ancestor.comment.id
    );
  }
  const targetAuthorLabel = getParticipantLabel(
    targetComment.authorId,
    targetComment.authorName,
    targetComment.id
  );

  const lines: string[] = [
    "Contribution type: comment",
    "Decision scope: evaluate only the target comment for rule violations.",
    "Participant labels are anonymized and consistent: the same label means the same Reddit author.",
    "",
    "Post context at top of thread:",
  ];

  if (postContext == null) {
    lines.push("- unavailable");
  } else {
    const postAuthorLabel = getParticipantLabel(
      postContext.authorId,
      postContext.authorName,
      postContext.id
    );
    lines.push(`- author: ${postAuthorLabel}`);
    lines.push(
      `- title: ${sanitizePromptSegment(
        postContext.title,
        MAX_POST_CONTEXT_TITLE_CHARS,
        "[untitled]"
      )}`
    );

    const trimmedPostBody = postContext.body?.trim();
    if (trimmedPostBody != null && trimmedPostBody.length > 0) {
      lines.push(
        `- body: ${sanitizePromptSegment(
          trimmedPostBody,
          MAX_POST_CONTEXT_BODY_CHARS,
          "[empty body]"
        )}`
      );
    } else {
      lines.push(
        `- url: ${sanitizePromptSegment(
          postContext.url,
          MAX_POST_CONTEXT_URL_CHARS,
          "[missing URL]"
        )}`
      );
    }
  }

  lines.push("", "Parent chain context (oldest -> newest):");

  if (selectedAncestors.length === 0) {
    lines.push("- none (the target comment replies directly to the post)");
  } else {
    for (const ancestor of selectedAncestors) {
      const ancestorLabel = getParticipantLabel(
        ancestor.comment.authorId,
        ancestor.comment.authorName,
        ancestor.comment.id
      );
      lines.push(`- relation: ${describeAncestorRelation(ancestor.distanceFromTarget)}`);
      lines.push(`  author: ${ancestorLabel}`);
      lines.push(
        `  text: ${sanitizePromptSegment(
          ancestor.comment.body,
          MAX_ANCESTOR_COMMENT_CONTEXT_CHARS,
          "[empty comment]"
        )}`
      );
    }
  }

  if (omittedAncestorCount > 0) {
    lines.push(
      `- note: ${omittedAncestorCount} middle ancestor comment(s) omitted for brevity`
    );
  }
  if (truncatedByFetchLimit) {
    lines.push(
      `- note: ancestors above ${MAX_COMMENT_CONTEXT_ANCESTORS_TO_FETCH} levels were not fetched`
    );
  }

  lines.push(
    "",
    "Target comment (this is the item to moderate):",
    `- author: ${targetAuthorLabel}`,
    `- text: ${sanitizePromptSegment(
      targetComment.body,
      MAX_TARGET_COMMENT_CONTEXT_CHARS,
      "[empty comment]"
    )}`
  );

  return sanitizeUntrustedText(lines.join("\n"), MAX_CONTENT_CHARS);
}

/**
 * Keeps root + newest ancestors when the chain is too long for prompt context.
 */
export function selectAncestorsForPrompt(
  ancestorsOldestToNewest: AncestorContextEntry[]
): {
  selectedAncestors: AncestorContextEntry[];
  omittedAncestorCount: number;
} {
  if (ancestorsOldestToNewest.length <= MAX_COMMENT_CONTEXT_ANCESTORS_IN_PROMPT) {
    return {
      selectedAncestors: ancestorsOldestToNewest,
      omittedAncestorCount: 0,
    };
  }

  const newestSlots = Math.max(1, MAX_COMMENT_CONTEXT_ANCESTORS_IN_PROMPT - 1);
  const rootAncestor = ancestorsOldestToNewest[0];
  const newestAncestors = ancestorsOldestToNewest.slice(-newestSlots);
  const selectedAncestors = [rootAncestor, ...newestAncestors];

  return {
    selectedAncestors,
    omittedAncestorCount: ancestorsOldestToNewest.length - selectedAncestors.length,
  };
}

/**
 * Returns a stable anonymized participant label for each unique author key.
 */
export function createParticipantLabeler(): (
  authorId: string | undefined,
  authorName: string,
  sourceId: string
) => string {
  const labelsByAuthorKey = new Map<string, string>();
  let nextLabelNumber = 1;

  return (authorId, authorName, sourceId) => {
    const authorKey = buildParticipantKey(authorId, authorName, sourceId);
    const existingLabel = labelsByAuthorKey.get(authorKey);
    if (existingLabel != null) {
      return existingLabel;
    }

    const newLabel = `User_${nextLabelNumber}`;
    nextLabelNumber += 1;
    labelsByAuthorKey.set(authorKey, newLabel);
    return newLabel;
  };
}

/**
 * Computes a local, anonymized key for linking contributions by author.
 */
export function buildParticipantKey(
  authorId: string | undefined,
  authorName: string,
  sourceId: string
): string {
  if (authorId != null && authorId.trim().length > 0) {
    return `id:${authorId.trim().toLowerCase()}`;
  }

  const normalizedAuthorName = authorName.trim().toLowerCase();
  if (normalizedAuthorName.length > 0 && normalizedAuthorName !== "[deleted]") {
    return `name:${normalizedAuthorName}`;
  }

  return `unknown:${sourceId}`;
}

/**
 * Converts a comment-like object into a context snapshot.
 */
export function toPromptContextComment(comment: {
  id: string;
  parentId: string;
  postId: string;
  authorId?: string;
  authorName: string;
  body: string;
}): PromptContextComment {
  return {
    id: comment.id,
    parentId: comment.parentId,
    postId: comment.postId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    body: comment.body,
  };
}

/**
 * Walks up the reply chain and returns parent comments nearest-first.
 */
async function fetchCommentAncestors(
  reddit: RedditAPIClient,
  targetComment: PromptContextComment
): Promise<{
  ancestorsClosestFirst: PromptContextComment[];
  truncatedByFetchLimit: boolean;
}> {
  const ancestorsClosestFirst: PromptContextComment[] = [];
  const seenCommentIds = new Set<string>([targetComment.id]);
  let currentComment = targetComment;
  let fetchedCount = 0;

  while (
    fetchedCount < MAX_COMMENT_CONTEXT_ANCESTORS_TO_FETCH &&
    currentComment.parentId.startsWith("t1_")
  ) {
    const parentId = currentComment.parentId;
    if (seenCommentIds.has(parentId)) {
      break;
    }
    seenCommentIds.add(parentId);

    try {
      const parentComment = await reddit.getCommentById(parentId);
      const parentSnapshot = toPromptContextComment(parentComment);
      ancestorsClosestFirst.push(parentSnapshot);
      currentComment = parentSnapshot;
      fetchedCount += 1;
    } catch (error) {
      console.warn(
        `Could not fetch parent comment ${parentId} while building context for ${targetComment.id}`,
        error
      );
      break;
    }
  }

  return {
    ancestorsClosestFirst,
    truncatedByFetchLimit:
      fetchedCount >= MAX_COMMENT_CONTEXT_ANCESTORS_TO_FETCH &&
      currentComment.parentId.startsWith("t1_"),
  };
}

/**
 * Converts a post-like object into a context snapshot.
 */
function toPromptContextPost(post: {
  id: string;
  authorId?: string;
  authorName: string;
  title: string;
  body?: string;
  url: string;
}): PromptContextPost {
  return {
    id: post.id,
    authorId: post.authorId,
    authorName: post.authorName,
    title: post.title,
    body: post.body,
    url: post.url,
  };
}

/**
 * Describes ancestor relationship labels relative to the target comment.
 */
function describeAncestorRelation(distanceFromTarget: number): string {
  if (distanceFromTarget === 1) {
    return "parent";
  }
  if (distanceFromTarget === 2) {
    return "grandparent";
  }
  if (distanceFromTarget === 3) {
    return "great-grandparent";
  }

  return `ancestor (${distanceFromTarget} levels above target)`;
}

/**
 * Sanitizes a context segment for safe prompt inclusion with a fallback value.
 */
function sanitizePromptSegment(
  value: string | undefined,
  maxChars: number,
  emptyFallback: string
): string {
  const sanitized = sanitizeUntrustedText(value ?? "", maxChars);
  return sanitized.length > 0 ? sanitized : emptyFallback;
}
