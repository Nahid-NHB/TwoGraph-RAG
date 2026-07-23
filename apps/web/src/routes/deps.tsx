import { useParams } from 'react-router-dom';
import { DepsExplorer } from '../deps/DepsExplorer.js';

/** `/repos/:repoId/deps` — dependency explorer (issue #62). */
export function DepsPage() {
  const { repoId } = useParams<{ repoId: string }>();
  if (!repoId) return null;
  return <DepsExplorer repoId={repoId} />;
}
