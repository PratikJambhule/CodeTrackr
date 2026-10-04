import { ButtonLink } from '../../components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-start gap-5 px-4 py-24 sm:px-6">
      <span className="eyebrow">404</span>
      <h1 className="display text-balance text-[64px]">Off the track</h1>
      <p className="text-lg text-muted">This page does not exist. The link may be old, or mistyped.</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink to="/" variant="primary">
          Go home
        </ButtonLink>
        <ButtonLink to="/guide">Read the guide</ButtonLink>
      </div>
    </div>
  );
}
