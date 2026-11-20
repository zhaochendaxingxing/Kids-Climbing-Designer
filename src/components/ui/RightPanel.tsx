import { useState, useMemo } from 'react';
import Image from 'next/image';
import { Check } from 'lucide-react';
import PartThumbnail from '@/components/three/PartThumbnail';
import { Button, Modal, Input, message, Popconfirm, Tag, Empty, Tooltip } from 'antd';
import {
  SaveOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  EditOutlined,
  DownloadOutlined,
  BarChartOutlined,
  DiffOutlined,
  AppstoreOutlined,
  HomeOutlined,
  DoubleRightOutlined,
  LeftOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useStore } from '@/store/useStore';
import type { PartCategory, PartDefinition } from '@/types/parts';
import { CATEGORY_CONFIG, PARTS_LIBRARY, COMBO_45L, EXT_BARS, EXT_PLATES, SPECIAL_EXTENSIONS, getPartById, getPartColor } from '@/data/parts';
import { BRIDGE_ACCESSORY, FINISHED_PRODUCTS, LADDER_ACCESSORY, SLIDE_ACCESSORY } from '@/data/finishedProducts';

// ==================== DESIGN.md 色彩令牌 ====================
const C = {
  primary: '#4A90D9',
  primarySoft: '#E3EFFB',
  accent: '#FF9F43',
  success: '#26C281',
  successSoft: '#E6F7EF',
  error: '#EE5A5A',
  errorSoft: '#FDEEEE',
  warn: '#F7CA45',
  warnSoft: '#FEF7DD',
  bg: '#FFFFFF',
  card: '#FFFFFF',
  text: '#283544',
  text2: '#6B7887',
  line: '#EEF1F4',
  railBg: '#FFFFFF',
};

// ==================== 基本配件网格 ====================
function PartCard({
  part,
  onPick,
}: {
  part: PartDefinition;
  onPick: (partId: string, colorId: string) => void;
}) {
  const draggingPart = useStore((state) => state.draggingPart);
  const active = draggingPart?.partId === part.id;
  const [selectedColor, setSelectedColor] = useState(active ? draggingPart.colorId : part.defaultColor);
  const colorHex = getPartColor(part, selectedColor)?.hex ?? '#CCCCCC';
  const dimensions = part.slideSpec
    ? `长 ${part.slideSpec.run} cm · 内宽 ${part.slideSpec.innerWidth} cm`
    : part.barSpec
    ? `长度 ${part.barSpec.length} cm`
    : part.connectorSpec
      ? '适配 4 cm 圆管'
      : part.extKind === 'rainbow' && part.platformSpec
        ? `${part.platformSpec.plateWidth} × ${part.platformSpec.plateDepth} cm`
        : `${part.size.width} × ${part.size.depth} cm`;

  return (
    <article className="designer-part-card" data-active={active}>
      <button
        className="designer-part-select"
        aria-label={`选择${part.name}`}
        aria-pressed={active}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('application/x-climbing-part', part.id);
          onPick(part.id, selectedColor);
        }}
        onDragEnd={() => {
          const state = useStore.getState();
          if (state.draggingPart?.partId === part.id) state.setDraggingPart(null);
        }}
        onClick={() => onPick(part.id, selectedColor)}
      >
        <PartThumbnail part={part} color={colorHex} />
        {active && (
          <span className="designer-part-check">
            <Check size={11} aria-hidden="true" />
          </span>
        )}
        <strong>{part.name}</strong>
        <span>{dimensions}</span>
      </button>
      {part.category !== 'connector' && (
        <div
          className="designer-part-colors"
          role="group"
          aria-label={`${part.name}配色`}
        >
          {part.colors.map((color) => (
            <button
              key={color.id}
              type="button"
              aria-label={`${part.name}：${color.name}`}
              aria-pressed={selectedColor === color.id}
              title={color.name}
              style={{ '--part-color': color.hex } as React.CSSProperties}
              onClick={() => {
                setSelectedColor(color.id);
                if (active) onPick(part.id, color.id);
              }}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function BasicPartsGrid() {
  const setDraggingPart = useStore((state) => state.setDraggingPart);
  const setPendingPreset = useStore((state) => state.setPendingPreset);
  const [category, setCategory] = useState<PartCategory | 'all'>('all');
  const partsByCategory = useMemo(() => {
    const result: Record<PartCategory, PartDefinition[]> = {
      bar: [],
      connector: [],
      platform: [],
    };
    PARTS_LIBRARY.forEach((part) => {
      if (part.id === 'connector-45deg-nest' || part.extension) return;
      result[part.category].push(part);
    });
    return result;
  }, []);
  const categories =
    category === 'all'
      ? (Object.keys(CATEGORY_CONFIG) as PartCategory[])
      : [category];
  const comboVisible = categories.includes('connector');
  const pick = (partId: string, colorId: string) =>
    setDraggingPart({ partId, colorId });
  const armCombo = () => {
    setPendingPreset({
      id: COMBO_45L.id,
      name: COMBO_45L.name,
      parts: COMBO_45L.parts,
    });
    message.success(
      `已选中「${COMBO_45L.name}」，点击场景地面部署（Esc 取消）`,
    );
  };

  return (
    <div className="designer-library">
      <div className="designer-categories" role="group" aria-label="配件分类">
        <button
          aria-pressed={category === 'all'}
          onClick={() => setCategory('all')}
        >
          全部
        </button>
        {(Object.keys(CATEGORY_CONFIG) as PartCategory[]).map((key) => (
          <button
            key={key}
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
          >
            {CATEGORY_CONFIG[key].name}
          </button>
        ))}
      </div>
      <div className="designer-catalog-scroll">
        {categories.map((cat) => {
          const parts = partsByCategory[cat];
          if (parts.length === 0 && !(cat === 'connector' && comboVisible))
            return null;
          return (
            <section
              key={cat}
              className="designer-part-section"
              aria-label={CATEGORY_CONFIG[cat].name}
            >
              <h3>
                {CATEGORY_CONFIG[cat].name}
                <span>{CATEGORY_CONFIG[cat].description}</span>
              </h3>
              <div className="designer-parts-grid">
                {parts.map((part) => (
                  <PartCard key={part.id} part={part} onPick={pick} />
                ))}
                {cat === 'connector' && comboVisible && (
                  <button className="designer-combo-card" onClick={armCombo}>
                    <div className="designer-combo-images">
                      {COMBO_45L.parts.map((item) => {
                        const definition = getPartById(item.partId);
                        return definition ? (
                          <PartThumbnail
                            key={item.id}
                            part={definition}
                            color="#2B2B2B"
                          />
                        ) : null;
                      })}
                    </div>
                    <strong>{COMBO_45L.name}</strong>
                    <span>两件嵌套组合</span>
                  </button>
                )}
              </div>
            </section>
          );
        })}
        {!comboVisible &&
          categories.every((key) => partsByCategory[key].length === 0) && (
            <Empty
              description="这个分类暂无配件"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
      </div>
    </div>
  );
}

const EXTENSION_CATEGORIES = [
  { id: 'special', label: '特殊扩展配件', hint: '拖入匹配的框架', parts: SPECIAL_EXTENSIONS },
  { id: 'bar', label: '扩展杆件', hint: '也可右键替换基本杆件', parts: EXT_BARS },
  { id: 'platform', label: '扩展平台板', hint: '也可右键替换基础平台板', parts: EXT_PLATES },
] as const;

function ExtensionPartsGrid() {
  const setDraggingPart = useStore((state) => state.setDraggingPart);
  const [category, setCategory] = useState<'all' | typeof EXTENSION_CATEGORIES[number]['id']>('all');
  const visible = EXTENSION_CATEGORIES.filter(group => category === 'all' || group.id === category);
  const pick = (partId: string, colorId: string) => setDraggingPart({ partId, colorId });

  return (
    <div className="designer-library">
      <div className="designer-categories" role="group" aria-label="扩展配件分类">
        <button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>全部</button>
        {EXTENSION_CATEGORIES.map(group => (
          <button key={group.id} type="button" aria-pressed={category === group.id} onClick={() => setCategory(group.id)}>
            {group.label}
          </button>
        ))}
      </div>
      <div className="designer-catalog-scroll">
        {visible.filter(group => group.id === 'special' || group.parts.length > 0).map(group => (
          <section key={group.id} className="designer-part-section" aria-label={group.label}>
            <h3>{group.label}<span>{group.hint}</span></h3>
            <div className="designer-parts-grid">
              {group.parts.map(part => <PartCard key={part.id} part={part} onPick={pick} />)}
              {group.id === 'special' && [SLIDE_ACCESSORY, LADDER_ACCESSORY, BRIDGE_ACCESSORY].map(preset => (
                <SpecialAssemblyCard key={preset.id} preset={preset} />
              ))}
            </div>
          </section>
        ))}
        {visible.every(group => group.id !== 'special' && group.parts.length === 0) && (
          <Empty description="这个分类暂无配件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    </div>
  );
}

function SpecialAssemblyCard({ preset }: { preset: typeof SLIDE_ACCESSORY | typeof LADDER_ACCESSORY | typeof BRIDGE_ACCESSORY }) {
  const setPreset = useStore(state => state.setPendingPreset);
  const active = useStore(state => state.pendingPreset?.id === preset.id);
  return (
    <article className="designer-part-card" data-active={active}>
      <button type="button" className="designer-part-select" aria-label={`选择${preset.name}`}
        aria-pressed={active} draggable
        onClick={() => setPreset(active ? null : preset)}
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('application/x-climbing-part', preset.id);
          setPreset(preset);
        }}
        onDragEnd={() => {
          if (useStore.getState().pendingPreset?.id === preset.id) setPreset(null);
        }}>
        <PartThumbnail preset={preset} />
        <strong>{preset.name}</strong>
        <span>{preset.description}</span>
      </button>
    </article>
  );
}

function FinishedProducts() {
  return <div className="space-y-3">{FINISHED_PRODUCTS.map(product => <FinishedProductCard key={product.id} product={product} />)}</div>;
}

function FinishedProductCard({ product }: { product: typeof FINISHED_PRODUCTS[number] }) {
  const setPendingPreset = useStore((state) => state.setPendingPreset);
  const selected = useStore((state) => state.pendingPreset?.id === product.id);
  return (
    <article className="designer-part-card" data-active={selected}>
      <Image
        src={product.thumbnail}
        alt={`${product.name}的 3D 模型预览`}
        width={1000}
        height={1040}
        unoptimized
        className="block h-auto w-full"
      />
      <div className="space-y-2 p-3">
        <h3 className="font-semibold">{product.name}</h3>
        <p className="text-xs" style={{ color: C.text2 }}>{product.description}</p>
        <Button
          type={selected ? 'default' : 'primary'}
          block
          onClick={() => setPendingPreset(selected ? null : product)}
        >
          {selected ? '取消放置' : '放入场景'}
        </Button>
        {selected && <p role="status" className="text-xs" style={{ color: C.text2 }}>点击场景地面放置，按 Esc 取消。</p>}
      </div>
    </article>
  );
}

// ==================== 统计信息 ====================
function PartsSummary() {
  const getPartsSummary = useStore((state) => state.getPartsSummary);
  const parts = useStore((state) => state.parts);
  const exportJSON = useStore((state) => state.exportJSON);
  const exportCSV = useStore((state) => state.exportCSV);

  const summary = useMemo(() => parts.length === 0 ? [] : getPartsSummary(), [getPartsSummary, parts]);
  const totalCount = useMemo(() => summary.reduce((sum, i) => sum + i.count, 0), [summary]);

  const groupedByCategory = useMemo(() => {
    const result: Record<string, typeof summary> = {};
    summary.forEach((item) => {
      (result[item.category] = result[item.category] || []).push(item);
    });
    return result;
  }, [summary]);

  const catTotal = (cat: string) => (groupedByCategory[cat] || []).reduce((s, i) => s + i.count, 0);
  const catMeta: Record<string, { label: string; color: string }> = {
    bar: { label: '杆件', color: C.primary },
    connector: { label: '连接件', color: C.accent },
    platform: { label: '平台板', color: C.success },
  };

  const doExport = (kind: 'json' | 'csv') => {
    const content = kind === 'json' ? exportJSON() : exportCSV();
    const blob = new Blob([kind === 'csv' ? `\uFEFF${content}` : content], {
      type: kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'json' ? `攀爬架设计_${new Date().toLocaleDateString()}.json` : `配件清单_${new Date().toLocaleDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(kind === 'json' ? 'JSON 导出成功' : 'CSV 导出成功');
  };

  const counts = ['bar', 'connector', 'platform'].map((cat) => ({ cat, n: catTotal(cat) }));

  return (
    <div className="space-y-3">
      {/* 计数卡 */}
      <div className="grid grid-cols-2 gap-2.5">
        {counts.map(({ cat, n }) => (
          <div key={cat} className="rounded-xl bg-white p-3 text-center" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div className="text-[22px] font-bold leading-none" style={{ color: catMeta[cat].color }}>{n}</div>
            <div className="text-[11px] mt-1" style={{ color: C.text2 }}>{catMeta[cat].label}</div>
          </div>
        ))}
        <div
          className="rounded-xl p-3 border-2 flex-1 min-w-full col-span-2 text-center"
          style={{ borderStyle: 'dashed', borderColor: C.line, background: C.primarySoft }}
        >
          <span className="text-[13px] font-semibold" style={{ color: C.primary }}>共 {totalCount} 件</span>
        </div>
      </div>

      {parts.length === 0 ? (
        <div className="py-4"><Empty description="暂无配件" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
      ) : (
        <>
          {/* 用料构成 */}
          <div className="rounded-xl bg-white p-3" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div className="text-[12px] font-medium mb-2 flex items-center justify-between" style={{ color: C.text }}>
              <span>用料构成</span>
              <span className="text-[10px]" style={{ color: C.text2 }}>单位：件</span>
            </div>
            <div className="space-y-2">
              {counts.map(({ cat, n }) => (
                <div key={cat}>
                  <div className="flex justify-between text-[11px] mb-1" style={{ color: C.text2 }}>
                    <span>{catMeta[cat].label}</span>
                    <span>{n} / {totalCount}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: C.bg }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: totalCount ? `${(n / totalCount) * 100}%` : '0%', background: catMeta[cat].color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 分类明细 */}
          {Object.entries(groupedByCategory).map(([category, items]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-medium" style={{ color: C.text2 }}>{catMeta[category]?.label || category}</span>
                <span className="text-[10px]" style={{ color: C.text2 }}>{catTotal(category)} 件</span>
              </div>
              <div className="rounded-xl bg-white overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                {items.map((item) => (
                  <div key={item.partId} className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
                    <span className="text-[13px]" style={{ color: C.text }}>{item.partName}</span>
                    <span className="text-[13px] font-semibold" style={{ color: C.primary }}>× {item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {/* 导出 */}
      <div className="flex gap-2">
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={() => doExport('json')}
          className="flex-1 rounded-full text-[13px]"
          style={{ background: C.primary }}
        >
          导出 JSON
        </Button>
        <Button
          icon={<DownloadOutlined />}
          onClick={() => doExport('csv')}
          className="flex-1 rounded-full text-[13px]"
          style={{ borderColor: C.line, color: C.text }}
        >
          导出 CSV
        </Button>
      </div>
    </div>
  );
}

// ==================== 存储方案 ====================
function ProjectsPanel() {
  const projects = useStore((state) => state.projects);
  const currentProjectId = useStore((state) => state.currentProjectId);
  const saveProject = useStore((state) => state.saveProject);
  const loadProject = useStore((state) => state.loadProject);
  const deleteProject = useStore((state) => state.deleteProject);
  const duplicateProject = useStore((state) => state.duplicateProject);
  const renameProject = useStore((state) => state.renameProject);
  const newProject = useStore((state) => state.newProject);
  const startCompare = useStore((state) => state.startCompare);

  const [renameModal, setRenameModal] = useState<{ visible: boolean; id: string; name: string }>({ visible: false, id: '', name: '' });
  const [saveName, setSaveName] = useState('');
  const [comparisonIds, setComparisonIds] = useState<string[] | null>(null);
  const [confirmComparison, setConfirmComparison] = useState(false);
  const [beforeId, setBeforeId] = useState('');
  const comparisonProjects = (comparisonIds ?? []).flatMap(id => projects.filter(project => project.id === id));

  const handleSave = () => {
    const current = useStore.getState().getCurrentProject();
    setSaveName(current?.name || '我的框架');
  };

  const confirmSave = () => {
    saveProject(saveName || '我的框架');
    setSaveName('');
    message.success('方案保存成功');
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-3">
      {/* 顶部操作 */}
      <div className="flex gap-2">
        <Button icon={<PlusOutlined />} onClick={newProject} className="flex-1 rounded-full text-[13px]" style={{ borderColor: C.line, color: C.text }}>
          新建
        </Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          className="flex-1 rounded-full text-[13px]"
          style={{ background: C.primary }}
        >
          保存
        </Button>
      </div>

      <div className="designer-compare-toolbar">
        <span>{comparisonIds ? `已勾选 ${comparisonProjects.length} / 2 个方案` : '方案列表'}</span>
        {comparisonIds ? (
          <div className="flex flex-wrap gap-1.5">
            <Button size="small" onClick={() => setComparisonIds(null)}>取消</Button>
            <Button type="primary" size="small" disabled={comparisonProjects.length !== 2} onClick={() => {
              setBeforeId('');
              setConfirmComparison(true);
            }}>确认前后</Button>
          </div>
        ) : (
          <Button size="small" icon={<DiffOutlined aria-hidden="true" />} disabled={projects.length < 2}
            onClick={() => setComparisonIds([])}>对比方案</Button>
        )}
      </div>
      <div className="space-y-2.5 max-h-[46vh] overflow-y-auto">
        {projects.length === 0 ? (
          <Empty description="暂无方案" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          projects.map((project) => {
            const active = currentProjectId === project.id;
            const checked = comparisonIds?.includes(project.id) ?? false;
            const atLimit = comparisonProjects.length === 2 && !checked;
            const ProjectName = comparisonIds ? 'label' : 'div';
            return (
              <div
                key={project.id}
                className={`rounded-xl bg-white p-3 transition-all${comparisonIds ? '' : ' cursor-pointer'}`}
                style={{
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  border: `2px solid ${(comparisonIds ? checked : active) ? C.primary : 'transparent'}`,
                  background: checked ? C.primarySoft : undefined,
                }}
                onClick={comparisonIds ? undefined : () => loadProject(project.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <ProjectName className="flex items-center min-w-0 gap-2">
                    {comparisonIds ? (
                      <input type="checkbox" checked={checked} disabled={atLimit} aria-label={`勾选${project.name}`}
                        className="designer-compare-check" onChange={() => setComparisonIds(ids => {
                          if (!ids) return ids;
                          return checked ? ids.filter(id => id !== project.id) : [...ids, project.id];
                        })} />
                    ) : <FolderOpenOutlined style={{ color: active ? C.primary : C.accent }} />}
                    <span className="text-[13px] font-medium truncate" style={{ color: C.text }}>{project.name}</span>
                  </ProjectName>
                  {active && <span className="px-1.5 py-0.5 rounded-full text-[10px] shrink-0" style={{ background: C.primarySoft, color: C.primary }}>当前</span>}
                </div>
                <div className="text-[11px] mt-1" style={{ color: C.text2 }}>
                  {project.parts.length} 配件 · {formatDate(project.updatedAt)}
                </div>
                {!comparisonIds && <div className="flex gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="重命名">
                    <Button type="text" size="small" icon={<EditOutlined />} className="h-6 px-1" style={{ color: C.text2 }} onClick={() => setRenameModal({ visible: true, id: project.id, name: project.name })} />
                  </Tooltip>
                  <Tooltip title="复制">
                    <Button type="text" size="small" icon={<CopyOutlined />} className="h-6 px-1" style={{ color: C.text2 }} onClick={() => { duplicateProject(project.id); message.success('已复制方案'); }} />
                  </Tooltip>
                  <Popconfirm
                    title="确定删除此方案吗？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => { deleteProject(project.id); message.success('已删除'); }}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} className="h-6 px-1" style={{ color: C.error }} />
                  </Popconfirm>
                </div>}
              </div>
            );
          })
        )}
      </div>

      <Modal title="确认改造前后" open={confirmComparison} okText="查看配件变化" cancelText="返回勾选"
        okButtonProps={{ disabled: !beforeId || comparisonProjects.length !== 2 }}
        onCancel={() => setConfirmComparison(false)} onOk={() => {
          const after = comparisonProjects.find(project => project.id !== beforeId);
          if (beforeId && after && comparisonProjects.length === 2) startCompare(beforeId, after.id);
        }}>
        <fieldset className="designer-compare-roles">
          <legend>选择改造前的方案，另一个即为改造后。</legend>
          {comparisonProjects.map(project => (
            <label key={project.id}>
              <input type="radio" name="comparison-before" className="designer-compare-check"
                checked={beforeId === project.id} onChange={() => setBeforeId(project.id)} />
              <span>{project.name}</span>
              {beforeId && <Tag color={beforeId === project.id ? 'default' : 'blue'}>
                {beforeId === project.id ? '改造前' : '改造后'}
              </Tag>}
            </label>
          ))}
        </fieldset>
      </Modal>

      {/* 保存弹窗 */}
      <Modal title="保存方案" open={!!saveName} onOk={confirmSave} onCancel={() => setSaveName('')} okText="保存" cancelText="取消">
        <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="输入方案名称" className="rounded-lg" />
      </Modal>

      {/* 重命名弹窗 */}
      <Modal
        title="重命名方案"
        open={renameModal.visible}
        okText="确定"
        cancelText="取消"
        onOk={() => { renameProject(renameModal.id, renameModal.name); setRenameModal({ visible: false, id: '', name: '' }); message.success('重命名成功'); }}
        onCancel={() => setRenameModal({ visible: false, id: '', name: '' })}
      >
        <Input value={renameModal.name} onChange={(e) => setRenameModal({ ...renameModal, name: e.target.value })} placeholder="输入方案名称" className="rounded-lg" />
      </Modal>
    </div>
  );
}

// ==================== 版本对比 ====================
function DiffPanel() {
  const diffResult = useStore((state) => state.diffResult);
  const exitCompare = useStore((state) => state.exitCompare);

  if (!diffResult) return null;

  const groups = [
    { label: '新增型号', items: diffResult.addedParts, bg: C.successSoft, color: '#176346', icon: <ArrowUpOutlined /> },
    { label: '移除型号', items: diffResult.removedParts, bg: C.errorSoft, color: '#a33232', icon: <ArrowDownOutlined /> },
    { label: '数量或配色变化', items: diffResult.changedParts, bg: C.warnSoft, color: '#745605', icon: null },
  ];

  return (
    <div className="space-y-3">
      <Button size="small" icon={<LeftOutlined aria-hidden="true" />} onClick={exitCompare}>返回方案列表</Button>
      <dl className="designer-compare-direction">
        <div><dt>改造前</dt><dd>{diffResult.beforeName}</dd></div>
        <div><dt>改造后</dt><dd>{diffResult.afterName}</dd></div>
      </dl>
      <div className="grid grid-cols-3 gap-2">
        {groups.map(group => (
          <div key={group.label} className="rounded-lg p-2 text-center" style={{ background: group.bg, color: group.color }}>
            <div className="text-lg font-bold">
              {group.icon} {group.items.length}
            </div>
            <div className="text-[11px]">{group.label}</div>
          </div>
        ))}
      </div>

      {groups.filter(group => group.items.length > 0).map(group => (
        <section key={group.label} className="designer-compare-section" aria-label={group.label}>
          <h3>{group.label}</h3>
          <ul>
            {group.items.map(item => (
              <li key={item.partId}>
                <div className="designer-compare-count">
                  <strong>{item.partName}</strong>
                  <span>{item.oldCount} → {item.newCount} 件</span>
                  {item.change !== 0 && <b style={{ color: item.change > 0 ? '#176346' : '#a33232' }}>
                    {item.change > 0 ? '+' : ''}{item.change}
                  </b>}
                </div>
                <div className="designer-compare-colors">
                  {item.colors.map(({ colorId, oldCount, newCount }) => {
                    const part = getPartById(item.partId);
                    const color = part && getPartColor(part, colorId);
                    return <span key={colorId}>
                      {color && <i aria-hidden="true" style={{ background: color.hex }} />}
                      {color?.name ?? colorId} {oldCount} → {newCount}
                    </span>;
                  })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {groups.every(group => group.items.length === 0) && (
        <p className="text-center py-4" style={{ color: C.text2 }}>配件型号、数量和配色均无变化</p>
      )}
    </div>
  );
}

// ==================== 右侧功能菜单面板（壳） ====================
interface RightPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

type SectionKey = 'parts' | 'save' | 'stats';

const RAIL_ITEMS: { key: SectionKey; icon: React.ReactNode; label: string; presetSub?: 'basic' | 'preset' | 'ext' }[] = [
  { key: 'parts', icon: <AppstoreOutlined />, label: '基本配件', presetSub: 'basic' },
  { key: 'parts', icon: <StarOutlined />, label: '扩展配件', presetSub: 'ext' },
  { key: 'parts', icon: <HomeOutlined />, label: '成品产品', presetSub: 'preset' },
  { key: 'save', icon: <FolderOpenOutlined />, label: '存储方案' },
  { key: 'stats', icon: <BarChartOutlined />, label: '统计信息' },
];

export function RightPanel({ collapsed, onToggle }: RightPanelProps) {
  const [active, setActive] = useState<SectionKey>('parts');
  const [presetSub, setPresetSub] = useState<'basic' | 'preset' | 'ext'>(
    'basic',
  );
  const viewMode = useStore((state) => state.viewMode);
  const exitCompare = useStore((state) => state.exitCompare);
  const placingRainbow = useStore((state) => state.draggingPart?.partId === 'ext-plate-rainbow');
  const specialPart = useStore(state => getPartById(state.draggingPart?.partId ?? ''));
  const placingTrampoline = useStore(state =>
    getPartById(state.draggingPart?.partId ?? '')?.directPlacement === 'trampoline-frame');
  const placingLadder = useStore(state => state.pendingPreset?.directPlacement === 'ladder-edge');
  const placingBridge = useStore(state => state.pendingPreset?.directPlacement === 'bridge-bay');
  const placingSlide = useStore(state => state.pendingPreset?.directPlacement === 'slide-edge');
  const diffActive = viewMode === 'diff';
  const showCatalog = !diffActive && active === 'parts' && presetSub !== 'preset';

  const openSection = (key: SectionKey, sub?: 'basic' | 'preset' | 'ext') => {
    if (sub) setPresetSub(sub);
    if (diffActive && key !== 'save') exitCompare();
    setActive(key);
    if (collapsed) onToggle();
  };

  const title = diffActive
    ? { icon: <DiffOutlined />, label: '版本对比' }
    : active === 'save'
      ? { icon: <FolderOpenOutlined />, label: '存储方案' }
      : active === 'stats'
        ? { icon: <BarChartOutlined />, label: '统计信息' }
        : { icon: <AppstoreOutlined />, label: '基本配件' };

  // 展开面板主体内容
  let body: React.ReactNode = null;
  if (diffActive) {
    body = <DiffPanel />;
  } else if (active === 'save') {
    body = <ProjectsPanel />;
  } else if (active === 'stats') {
    body = <PartsSummary />;
  } else {
    body =
      presetSub === 'basic' ? (
        <BasicPartsGrid />
      ) : presetSub === 'preset' ? (
        <FinishedProducts />
      ) : (
        <ExtensionPartsGrid />
      );
  }

  return (
    <aside
      className={`designer-sidebar${collapsed ? ' is-collapsed' : ''}`}
      aria-label="配件和方案管理"
    >
      <nav className="designer-sidebar-tabs" aria-label="侧栏功能">
        {RAIL_ITEMS.map((item, index) => {
          const isActive =
            active === item.key &&
            (item.presetSub ? presetSub === item.presetSub : true);
          return (
            <Tooltip
              key={`${item.key}-${item.presetSub || index}`}
              title={collapsed ? item.label : undefined}
            >
              <button
                onClick={() => openSection(item.key, item.presetSub)}
                aria-label={item.label}
                aria-pressed={isActive}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span className="designer-tab-label">{item.label}</span>
              </button>
            </Tooltip>
          );
        })}
        {collapsed && (
          <button onClick={onToggle} aria-label="展开面板">
            <LeftOutlined />
          </button>
        )}
      </nav>
      {!collapsed && (
        <>
          <div className="designer-panel-header">
            <h2>
              {diffActive
                ? title.label
                : active === 'parts'
                  ? presetSub === 'basic'
                    ? '基本配件'
                    : presetSub === 'preset'
                      ? '成品产品'
                      : '扩展配件'
                  : title.label}
            </h2>
            <div>
              <button onClick={onToggle} aria-label="收起面板" title="收起面板">
                <DoubleRightOutlined />
              </button>
            </div>
          </div>
          <div className={`designer-panel-body${showCatalog ? ' is-catalog' : ''}`} data-testid="right-panel">
            {body}
          </div>
          {active !== 'save' && !(active === 'parts' && presetSub === 'preset') && (
            <div className="designer-panel-footer">
              <AppstoreOutlined />
              {placingBridge ? '指向两侧有连续扶手的 40 × 80 cm 框架'
                : placingLadder ? '指向水平杆或双段滑梯的空闲侧边'
                : placingSlide ? '拖入或点击侧面留空的水平杆件'
                : placingTrampoline ? '拖入或点击空的 80 × 80 cm 水平框架'
                : specialPart?.directPlacement === 'tall-rainbow-frame' ? `指向空的 40 × ${specialPart.platformSpec?.plateDepth} cm 竖向框格`
                : specialPart?.directPlacement === 'molded-slide' ? `指向约 ${specialPart.slideSpec?.rise} cm 高的水平长圆管`
                : specialPart?.directPlacement === 'hanging-bar' ? '指向下方留空的水平长圆管'
                : placingRainbow ? '点击空的 40 × 40 cm 竖向框格' : '选中配件，指向框架预览后点击放置'}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
