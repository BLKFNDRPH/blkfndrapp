import { CubeAvatar } from '@/components/layout/CubeAvatar';
import '@/app/loading.css';

/**
 * The jumping cube, for a page that has nothing to show yet (the login
 * landing while it finishes a sign-in).
 *
 * It used to be app/loading.tsx, which made it the fallback of a Suspense
 * boundary around every page. Next flushed that fallback first and streamed
 * each page's content into a hidden segment, which React only revealed on a
 * later animation frame: on a throttled phone the home page's hero text
 * appeared about two seconds after the HTML had arrived. Without a root
 * loading file the server renders a page's content in place.
 */
export default function PageLoading() {
  return (
    <div className="loading-container">
      <div className="jumpy-cube">
        <CubeAvatar />
      </div>
    </div>
  );
}
