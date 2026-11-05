import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReviewerUser } from '@targus/core';
import type { ReactElement } from 'react';

import { logout } from '../../api-client/index.js';

/** The signed-in reviewer in the header, with "Sign out". */
export function UserMenu({ user }: { readonly user: ReviewerUser }): ReactElement {
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: logout,
    // Every cached response belonged to the old session; refetching `me` now answers 401,
    // which swaps the page for the sign-in panel.
    onSuccess: () => queryClient.resetQueries(),
  });
  return (
    <div className="user-menu">
      <img className="avatar" src={user.avatarUrl} alt="" width={24} height={24} />
      <span className="login">{user.login}</span>
      <button
        type="button"
        className="button small"
        disabled={signOut.isPending}
        onClick={() => {
          signOut.mutate();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
