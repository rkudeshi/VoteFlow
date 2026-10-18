/* Not found: any path the router does not know (old /2026/... links included). */
class NotFound extends DCLogic {
  componentDidMount() { document.title = 'Page not found · VoteFlow'; }
  renderVals() { return { band: { asOf: '' } }; }
}
VF.page('notfound', NotFound);
