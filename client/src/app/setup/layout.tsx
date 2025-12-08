export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Setup page has its own full-screen layout without sidebar
  return <>{children}</>;
}
