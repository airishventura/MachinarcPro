/** Re-mounts on every navigation inside the app: content stages in while the shell stays still. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
