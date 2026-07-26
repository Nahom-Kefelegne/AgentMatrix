'use client';

// File-tree primitives shared by the changes/browse sidebars: a lightweight
// tree model plus presentational icon/row components.

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

export function buildFileTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
  for (const file of files) {
    const parts = file.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join('/');
      let child = current.children.find(c => c.name === part);
      if (!child) {
        child = { name: part, path: pathSoFar, isDir: !isLast, children: [] };
        current.children.push(child);
      }
      current = child;
    }
  }
  // Sort: dirs first, then files, alpha within each
  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    for (const n of nodes) if (n.isDir) sortTree(n.children);
  }
  sortTree(root.children);
  return root.children;
}

// File type colors (VS Code Material Icon Theme)
export const FILE_COLORS: Record<string, string> = {
  ts: '#3178c6', tsx: '#1a6fb5', js: '#f0db4f', jsx: '#61dafb',
  json: '#cbcb41', css: '#563d7c', scss: '#cd6799', less: '#1d365d',
  html: '#e44d26', xml: '#e44d26', svg: '#ffb13b',
  md: '#519aba', py: '#3572a5', rs: '#dea584', go: '#00add8',
  java: '#b07219', c: '#555', cpp: '#f34b7d', h: '#555',
  rb: '#cc342d', php: '#4f5d95', swift: '#f05138', kt: '#a97bff',
  sh: '#4ec962', bash: '#4ec962', zsh: '#4ec962',
  yaml: '#cb171e', yml: '#cb171e', toml: '#9c4121',
  sql: '#e38c00', graphql: '#e535ab', gql: '#e535ab',
  png: '#a074c4', jpg: '#a074c4', gif: '#a074c4', ico: '#a074c4',
  lock: '#555', env: '#faf743',
  gitignore: '#f05032', dockerfile: '#2496ed',
};

export function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const baseName = name.toLowerCase();
  const color = FILE_COLORS[baseName] || FILE_COLORS[ext] || '#666';

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13z" fill={color} fillOpacity="0.15" stroke={color} strokeWidth="1" />
      <path d="M9.5 1.5V5H13" stroke={color} strokeWidth="1" />
    </svg>
  );
}

export function FileTreeNode({ node, depth, selected, expanded, onSelect, onToggle, commentCounts }: {
  node: TreeNode; depth: number; selected: string | null;
  expanded: Set<string>; onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  commentCounts: Map<string, number>;
}) {
  const isOpen = expanded.has(node.path);
  const isSelected = selected === node.path;
  const count = commentCounts.get(node.path) || 0;

  if (node.isDir) {
    return (
      <>
        <div
          onClick={() => onToggle(node.path)}
          style={{
            padding: '3px 8px 3px',
            paddingLeft: 12 + depth * 16,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: '#ccc', fontWeight: 600,
            background: 'transparent',
            userSelect: 'none',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#1e1e26'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ fontSize: 10, color: '#666', width: 12, textAlign: 'center', flexShrink: 0 }}>
            {isOpen ? '\u25BE' : '\u25B8'}
          </span>
          <span style={{ fontSize: 14 }}>{isOpen ? '\uD83D\uDCC2' : '\uD83D\uDCC1'}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        </div>
        {isOpen && node.children.map(child => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            onSelect={onSelect}
            onToggle={onToggle}
            commentCounts={commentCounts}
          />
        ))}
      </>
    );
  }

  return (
    <div
      onClick={() => onSelect(node.path)}
      style={{
        padding: '3px 8px 3px',
        paddingLeft: 12 + depth * 16,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 13, color: isSelected ? '#eee' : '#aaa',
        background: isSelected ? '#1e1e26' : 'transparent',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#14141e'; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
    >
      <FileIcon name={node.name} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{node.name}</span>
      {count > 0 && (
        <span style={{ fontSize: 10, padding: '0 5px', borderRadius: 8, background: '#fbbf2420', color: '#fbbf24', fontWeight: 700, flexShrink: 0 }}>{count}</span>
      )}
    </div>
  );
}
