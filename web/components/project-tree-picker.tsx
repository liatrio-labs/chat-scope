import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

interface ProjectTreePickerProps {
  projects: string[];
  selectedProject: string | null;
  onSelectProject: (project: string | null) => void;
  onSearchStateChange?: (state: {
    query: string;
    hasMatches: boolean;
    matchCount: number;
  }) => void;
}

interface TreeNode {
  id: string;
  label: string;
  fullPath: string;
  selectable: boolean;
  children: TreeNode[];
}

function getPathSegments(projectPath: string): string[] {
  return projectPath.split("/").filter(Boolean);
}

function buildProjectTree(projects: string[]): TreeNode[] {
  type MutableNode = TreeNode & { childMap: Map<string, MutableNode> };
  const roots = new Map<string, MutableNode>();

  for (const project of projects) {
    const segments = getPathSegments(project);
    if (segments.length === 0) {
      continue;
    }

    let currentMap = roots;
    let currentPath = "";

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      currentPath = `${currentPath}/${segment}`;

      if (!currentMap.has(segment)) {
        currentMap.set(segment, {
          id: currentPath,
          label: segment,
          fullPath: currentPath,
          selectable: false,
          children: [],
          childMap: new Map<string, MutableNode>(),
        });
      }

      const node = currentMap.get(segment)!;
      if (index === segments.length - 1) {
        node.selectable = true;
      }
      currentMap = node.childMap;
    }
  }

  const finalize = (nodes: Map<string, MutableNode>): TreeNode[] => {
    return Array.from(nodes.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((node) => ({
        id: node.id,
        label: node.label,
        fullPath: node.fullPath,
        selectable: node.selectable,
        children: finalize(node.childMap),
      }));
  };

  return finalize(roots);
}

function getNodeKey(node: TreeNode): string {
  return node.fullPath;
}

export default function ProjectTreePicker(props: ProjectTreePickerProps) {
  const { projects, selectedProject, onSelectProject, onSearchStateChange } =
    props;
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildProjectTree(projects), [projects]);

  useEffect(() => {
    setExpanded((previous) => {
      const next = new Set(previous);
      for (const node of tree) {
        next.add(getNodeKey(node));
      }
      return next;
    });
  }, [tree]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredProjects = useMemo(() => {
    if (!normalizedSearch) {
      return [];
    }

    const matches = projects.filter((project) =>
      project.toLowerCase().includes(normalizedSearch),
    );

    return matches.sort((a, b) => {
      const aName = a.split("/").filter(Boolean).pop() ?? a;
      const bName = b.split("/").filter(Boolean).pop() ?? b;
      const aStarts = aName.toLowerCase().startsWith(normalizedSearch) ? 0 : 1;
      const bStarts = bName.toLowerCase().startsWith(normalizedSearch) ? 0 : 1;
      if (aStarts !== bStarts) {
        return aStarts - bStarts;
      }
      return a.localeCompare(b);
    });
  }, [normalizedSearch, projects]);

  useEffect(() => {
    if (!onSearchStateChange) {
      return;
    }

    if (!normalizedSearch) {
      onSearchStateChange({
        query: "",
        hasMatches: true,
        matchCount: projects.length,
      });
      return;
    }

    onSearchStateChange({
      query: search,
      hasMatches: filteredProjects.length > 0,
      matchCount: filteredProjects.length,
    });
  }, [
    filteredProjects.length,
    normalizedSearch,
    onSearchStateChange,
    projects.length,
    search,
  ]);

  const toggleNode = (nodeKey: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(nodeKey)) {
        next.delete(nodeKey);
      } else {
        next.add(nodeKey);
      }
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth = 0): ReactElement => {
    const nodeKey = getNodeKey(node);
    const isExpanded = expanded.has(nodeKey);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedProject === node.fullPath;

    return (
      <div key={nodeKey}>
        <div className="flex items-center">
          <button
            onClick={() => {
              if (hasChildren) {
                toggleNode(nodeKey);
              }
            }}
            className="h-7 w-6 shrink-0 text-[var(--brand-text-muted)] hover:text-[var(--brand-text-secondary)]"
            style={{ marginLeft: `${depth * 10}px` }}
            aria-label={hasChildren ? "Toggle folder" : "No children"}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="mx-auto h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="mx-auto h-3.5 w-3.5" />
              )
            ) : (
              <span className="mx-auto block h-3.5 w-3.5" />
            )}
          </button>

          {node.selectable ? (
            <button
              onClick={() => onSelectProject(node.fullPath)}
              className={`h-7 min-w-0 flex-1 truncate rounded-[8px] px-2 text-left text-sm transition-colors ${
                isSelected
                  ? "bg-[var(--brand-primary)]/20 text-[var(--brand-highlight)]"
                  : "text-[var(--brand-text-secondary)] hover:bg-[var(--brand-bg-tertiary)]/80"
              }`}
              title={node.fullPath}
            >
              {node.label}
            </button>
          ) : (
            <div
              className="h-7 min-w-0 flex-1 truncate px-2 text-sm text-[var(--brand-text-muted)]"
              title={node.fullPath}
            >
              {node.label}
            </div>
          )}
        </div>

        {hasChildren && isExpanded && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border-b border-[var(--brand-border)]/80 p-3">
      <div className="mb-2 flex items-center gap-2 rounded-[10px] border border-[var(--brand-border-soft)] bg-[var(--brand-bg-tertiary)]/70 px-3 py-2">
        <Search className="h-4 w-4 text-[var(--brand-text-muted)]" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search projects..."
          className="w-full bg-transparent text-sm text-[var(--brand-text-primary)] placeholder:text-[var(--brand-text-muted)] focus:outline-none"
        />
      </div>

      <button
        onClick={() => onSelectProject(null)}
        className={`mb-2 h-8 w-full rounded-[8px] px-2 text-left text-sm transition-colors ${
          selectedProject === null
            ? "bg-[var(--brand-primary)]/18 text-[var(--brand-highlight)]"
            : "text-[var(--brand-text-secondary)] hover:bg-[var(--brand-bg-tertiary)]/80"
        }`}
      >
        All Projects
      </button>

      <div className="max-h-48 overflow-y-auto pr-1">
        {normalizedSearch ? (
          filteredProjects.length > 0 ? (
            <div className="space-y-1">
              {filteredProjects.map((project) => {
                const name =
                  project.split("/").filter(Boolean).pop() ?? project;
                const isSelected = selectedProject === project;
                return (
                  <button
                    key={project}
                    onClick={() => onSelectProject(project)}
                    className={`w-full rounded-[8px] px-2 py-1.5 text-left transition-colors ${
                      isSelected
                        ? "bg-[var(--brand-primary)]/20"
                        : "hover:bg-[var(--brand-bg-tertiary)]/80"
                    }`}
                    title={project}
                  >
                    <div
                      className={`truncate text-sm ${
                        isSelected
                          ? "text-[var(--brand-highlight)]"
                          : "text-[var(--brand-text-primary)]"
                      }`}
                    >
                      {name}
                    </div>
                    <div className="truncate text-[11px] text-[var(--brand-text-muted)] font-mono">
                      {project}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-2 py-2 text-xs text-[var(--brand-text-muted)]">
              <div>No matching projects</div>
              <div className="mt-1 text-[10px] text-[var(--brand-text-muted)]/85">
                Sessions below may still match provider and session search
                filters.
              </div>
            </div>
          )
        ) : tree.length > 0 ? (
          <div>{tree.map((node) => renderNode(node))}</div>
        ) : (
          <div className="px-2 py-2 text-xs text-[var(--brand-text-muted)]">
            No projects found
          </div>
        )}
      </div>
    </div>
  );
}
