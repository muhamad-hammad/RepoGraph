// cytoscape-fcose ships no type definitions; declare it as a layout plugin.
declare module 'cytoscape-fcose' {
  import { Ext } from 'cytoscape';
  const ext: Ext;
  export default ext;
}
