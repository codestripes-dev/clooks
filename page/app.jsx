async function mountPage() {
  const response = await fetch('content.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load website content (${response.status})`);
  const data = await response.json();
  applyPageMetadata(data.root.props.metadata);
  function ReadyPage() {
    React.useEffect(() => { document.getElementById('root').dataset.contentReady = 'true'; }, []);
    return <PageEnvironment.Provider value={{ editing: window.__CLOOKS_PRERENDER__ === true, targetWindow: window }}><Site data={data}/></PageEnvironment.Provider>;
  }
  ReactDOM.createRoot(document.getElementById('root')).render(<ReadyPage/>);
}
mountPage().catch(error => {
  console.error(error);
  // Keep the prerendered page readable if a subsequent content request fails.
  const root = document.getElementById('root');
  if (!root.hasChildNodes()) root.textContent = 'The website could not load. Please reload.';
});
