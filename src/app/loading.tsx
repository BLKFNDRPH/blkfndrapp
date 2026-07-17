import { CubeAvatar } from '@/components/layout/CubeAvatar';
import './loading.css';

export default function Loading() {
  return (
    <div className="loading-container">
      <div className="jumpy-cube">
        <CubeAvatar />
      </div>
    </div>
  );
}
