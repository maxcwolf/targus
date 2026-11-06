import { Link, useNavigate } from '@tanstack/react-router';
import type { LibraryStory } from '@targus/core';
import { type ReactElement, useMemo } from 'react';

import { imageUrl } from '../../api-client/index.ts';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons.tsx';
import { SnapshotImage } from '../../components/SnapshotImage.tsx';
import { useHotkeys } from '../snapshot/index.ts';
import { storyKey, storyTitle } from './stories.ts';

export interface StoryCanvasProps {
  readonly projectId: string;
  readonly story: LibraryStory;
  /** The stories previous/next step through; it contains `story`. */
  readonly stories: readonly LibraryStory[];
}

function StepLink(props: {
  readonly projectId: string;
  readonly target: LibraryStory | undefined;
  readonly label: 'Previous' | 'Next';
  readonly title: string;
}): ReactElement {
  const icon = props.label === 'Previous' ? <ChevronLeftIcon /> : <ChevronRightIcon />;
  if (!props.target) {
    return (
      <span className="icon-button disabled" aria-disabled="true" title={props.title}>
        {icon}
      </span>
    );
  }
  return (
    <Link
      className="icon-button"
      to="/projects/$projectId/library"
      params={{ projectId: props.projectId }}
      search={{ story: storyKey(props.target) }}
      aria-label={props.label}
      title={props.title}
    >
      {icon}
    </Link>
  );
}

/** One story on its own, like Storybook's canvas, with previous/next through the library. */
export function StoryCanvas({ projectId, story, stories }: StoryCanvasProps): ReactElement {
  const navigate = useNavigate();
  const index = stories.findIndex((candidate) => storyKey(candidate) === storyKey(story));
  const previous = stories[index - 1];
  const next = stories[index + 1];
  const hotkeys = useMemo(() => {
    const open = (target: LibraryStory | undefined) => (): void => {
      const search = target ? { story: storyKey(target) } : {};
      void navigate({ to: '/projects/$projectId/library', params: { projectId }, search });
    };
    return {
      ...(next ? { j: open(next), ArrowRight: open(next) } : {}),
      ...(previous ? { k: open(previous), ArrowLeft: open(previous) } : {}),
      Escape: open(undefined),
    };
  }, [navigate, projectId, previous, next]);
  useHotkeys(hotkeys);
  const label = storyTitle(story);
  return (
    <div className="story-canvas">
      <div className="story-canvas-bar">
        <div className="bar-title-text">
          <h2 className="snapshot-title" title={label}>
            {label}
          </h2>
          <p className="subline mono">{story.storyId}</p>
        </div>
        <nav className="snapshot-nav" aria-label="Stories">
          <StepLink
            projectId={projectId}
            target={previous}
            label="Previous"
            title="Previous (k or ←)"
          />
          <span className="position">
            {index + 1} of {stories.length}
          </span>
          <StepLink projectId={projectId} target={next} label="Next" title="Next (j or →)" />
        </nav>
      </div>
      <div className="story-stage">
        <SnapshotImage src={imageUrl(story.imageHash)} alt={label} />
      </div>
    </div>
  );
}
