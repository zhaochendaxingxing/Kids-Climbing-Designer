'use client';

import { useState, useEffect } from 'react';
import { Tooltip, Button, Popover } from 'antd';
import {
  UndoOutlined,
  RedoOutlined,
  EyeOutlined,
  ControlOutlined,
  DownloadOutlined,
  BgColorsOutlined,
  SelectOutlined,
  CameraOutlined,
} from '@ant-design/icons';
import dynamic from 'next/dynamic';
import { RightPanel } from '@/components/ui/RightPanel';
import WorkflowTab from '@/components/ui/WorkflowTab';
import { useStore } from '@/store/useStore';
import { PART_COLORS, CATEGORY_CONFIG, getPartById } from '@/data/parts';
import type { PartCategory } from '@/types/parts';

// 动态导入 3D 场景（避免 SSR 问题）
const Scene3D = dynamic(() => import('@/components/three/Scene3D'), { ssr: false });

// DESIGN.md 色彩
const C = {
  primary: '#4A90D9',
  bgSurfaceCont: '#EFF3F6',
  text: '#333333',
  text2: '#6B7280',
  line: '#E4E9EE',
};

export default function HomePage() {
  const [selectedCount, setSelectedCount] = useState(0);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const setSnapEnabled = useStore((s) => s.setSnapEnabled);
  const gizmoMode = useStore((s) => s.gizmoMode);
  const setGizmoMode = useStore((s) => s.setGizmoMode);
  const navMode = useStore((s) => s.navMode);
  const setNavMode = useStore((s) => s.setNavMode);
  const paintColor = useStore((s) => s.paintColor);
  const setPaintColor = useStore((s) => s.setPaintColor);
  const parts = useStore((s) => s.parts);
  const paintSelected = useStore((s) => s.paintSelected);
  const randomColorSelected = useStore((s) => s.randomColorSelected);
  const replaceSelectedConnectors = useStore((s) => s.replaceSelectedConnectors);
  const optimizeSelectedConnectors = useStore((s) => s.optimizeSelectedConnectors);
  const selectByCategory = useStore((s) => s.selectByCategory);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const exportJSON = useStore((s) => s.exportJSON);
  const workflow = useStore((s) => s.workflow);
  const setWorkflow = useStore((s) => s.setWorkflow);
  const generateFramework = useStore((s) => s.generateFramework);
  const [paintOpen, setPaintOpen] = useState(false);
  const [selSameOpen, setSelSameOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [fwLayers, setFwLayers] = useState(3);
  const [fwCols, setFwCols] = useState(2);
  const [fwDepth, setFwDepth] = useState(2);
  const panelToggle = () => setPanelCollapsed((c) => !c);

  // “全选同类”当前选中的分类（菜单主题）
  const [pickCat, setPickCat] = useState<PartCategory | null>(null);
  // 与“基本配件”分项一致的三类
  const PICK_CATS = [
    { key: 'bar' as PartCategory, name: CATEGORY_CONFIG.bar.name, icon: '杆' },
    { key: 'connector' as PartCategory, name: CATEGORY_CONFIG.connector.name, icon: '连' },
    { key: 'platform' as PartCategory, name: CATEGORY_CONFIG.platform.name, icon: '板' },
  ];
  const catCountFor = (cat: PartCategory) => parts.filter((p) => getPartById(p.partId)?.category === cat).length;
  const pickCatName = pickCat ? (pickCat === 'bar' ? '杆件' : pickCat === 'connector' ? '连接件' : '平台板') : '';

  // 全选同类：取消移动/生长/上色等一切操作，仅弹出分类菜单
  const handleSelectSame = () => {
    setPaintColor(null);
    setGizmoMode('move');
    setSelSameOpen(true);
  };

  // 把选择数量更新挂到全局，Scene3D 可调用
  useEffect(() => {
    (window as any).__setSelectedCount = setSelectedCount;
    return () => {
      delete (window as any).__setSelectedCount;
    };
  }, []);

  const handleExport = () => {
    if (exportJSON().trim() === '[]') return;
    const json = exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `攀爬架设计_${new Date().toLocaleDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-background select-none relative overflow-hidden" style={{ background: '#FAFAF7' }}>
      {/* ===================== 顶部菜单区 ===================== */}
      <header
        className="h-14 shrink-0 flex items-center justify-between px-4 bg-white border-b z-20"
        style={{ borderColor: C.line, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}
      >
        {/* 品牌 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className="w-8 h-8 rounded-xl grid place-items-center"
              style={{ background: 'rgba(74,144,217,0.12)', color: C.primary }}
            >
              <i className="anticon"><ControlOutlined /></i>
            </span>
            <div>
              <div className="text-[15px] font-semibold leading-tight" style={{ color: C.text }}>
                攀爬架 DIY 设计器
              </div>
              <div className="text-[11px] leading-tight" style={{ color: C.text2 }}>
                儿童攀爬架 3D 搭建
              </div>
            </div>
          </div>
          <span
            className="ml-1 hidden md:inline-flex items-center text-[11px] px-2 py-1 rounded-full"
            style={{ background: C.bgSurfaceCont, color: C.text2 }}
          >
            工作台
          </span>
        </div>

        {/* 历史 / 视图操作 */}
        <div className="flex items-center gap-1 rounded-full px-1 py-1" style={{ background: C.bgSurfaceCont }}>
          <Tooltip title="撤销 (Ctrl+Z)">
            <button
              className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-white hover:text-primary"
              style={{ color: C.text2 }}
              onClick={undo}
            >
              <UndoOutlined />
            </button>
          </Tooltip>
          <Tooltip title="重做 (Ctrl+Y)">
            <button
              className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-white hover:text-primary"
              style={{ color: C.text2 }}
              onClick={redo}
            >
              <RedoOutlined />
            </button>
          </Tooltip>
          <span className="w-px h-5 mx-1" style={{ background: C.line }} />
          <Tooltip title="移动视角（平移观察）：点击后鼠标变为小手，按住左键拖拽可平移视角；再次点击退出">
            <button
              className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-white hover:text-primary"
              style={navMode === 'pan' ? { background: C.primary, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' } : { color: C.text2 }}
              onClick={() => { setNavMode(navMode === 'pan' ? 'none' : 'pan'); setSelSameOpen(false); }}
            >
              <ControlOutlined className="scale-x-[-1]" style={{ fontSize: 14 }} />
            </button>
          </Tooltip>
          <Tooltip title="旋转视角（围绕模型旋转）：点击后鼠标变为旋转图标，按住左键拖拽可旋转视角；再次点击退出">
            <button
              className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-white hover:text-primary"
              style={navMode === 'rotate' ? { background: C.primary, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' } : { color: C.text2 }}
              onClick={() => { setNavMode(navMode === 'rotate' ? 'none' : 'rotate'); setSelSameOpen(false); }}
            >
              <CameraOutlined style={{ fontSize: 14 }} />
            </button>
          </Tooltip>
          <Tooltip title="居中视角（重置观察方向）">
            <button
              className="w-8 h-8 rounded-full grid place-items-center transition-colors hover:bg-white hover:text-primary"
              style={{ color: C.text2 }}
              onClick={() => window.dispatchEvent(new CustomEvent('gizmo-reset-camera'))}
            >
              <EyeOutlined />
            </button>
          </Tooltip>
        </div>

        {/* 编辑工具：油漆桶 / 全选同类 / 吸附 */}
        <div className="flex items-center gap-2">
          <Popover
            trigger="click"
            open={paintOpen}
            onOpenChange={setPaintOpen}
            placement="bottom"
            content={
              <div className="w-60 p-2">
                <div className="text-[12px] font-semibold mb-2" style={{ color: C.text }}>给杆件 / 平台板 上色</div>
                <div className="flex flex-wrap gap-2">
                  {PART_COLORS.map((c) => (
                    <button
                      key={c.id}
                      title={c.name}
                      onClick={() => { setPaintColor(c.id); setSelSameOpen(false); setPaintOpen(false); }}
                      className="w-8 h-8 rounded-full cursor-pointer border transition-all"
                      style={{
                        background: c.hex,
                        borderColor: paintColor === c.id ? C.primary : C.line,
                        boxShadow: paintColor === c.id ? '0 0 0 2px rgba(74,144,217,0.4)' : 'none',
                        transform: paintColor === c.id ? 'scale(1.08)' : 'none',
                      }}
                    />
                  ))}
                </div>
                <div className="text-[11px] mt-2 leading-relaxed" style={{ color: C.text2 }}>
                  选择颜色后，点击场景中的杆件或平台板即可直接染色。
                </div>
                {paintColor && (
                  <button
                    onClick={() => { setPaintColor(null); setPaintOpen(false); }}
                    className="mt-2 w-full text-[12px] font-medium h-8 rounded-full transition-colors"
                    style={{ background: '#fff0f0', color: '#D14B4B', border: '1px solid #F5C6C6' }}
                  >
                    退出上色模式
                  </button>
                )}
              </div>
            }
          >
            <Tooltip title="油漆桶：选色后点按杆件/平台板直接上色">
              <button
                className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[13px] font-medium border transition-all"
                style={
                  paintColor
                    ? { background: 'rgba(74,144,217,0.12)', color: C.primary, borderColor: 'rgba(74,144,217,0.4)' }
                    : { background: '#fff', color: C.text2, borderColor: C.line }
                }
              >
                <BgColorsOutlined /> {paintColor ? '上色中' : '油漆桶'}
              </button>
            </Tooltip>
          </Popover>

          <Popover
            trigger="click"
            open={selSameOpen}
            onOpenChange={(v) => { setSelSameOpen(v); if (!v) setPickCat(null); }}
            placement="bottom"
            content={
              <div className="w-72 p-2">
                <div className="text-[12px] font-semibold mb-1.5" style={{ color: C.text }}>按类型全选同类</div>
                <div className="flex flex-col gap-1.5">
                  {PICK_CATS.map((c) => {
                    const count = catCountFor(c.key);
                    const active = pickCat === c.key;
                    return (
                      <button
                        key={c.key}
                        onClick={() => { selectByCategory(c.key); setPickCat(c.key); }}
                        className="flex items-center justify-between px-3 h-8 rounded-full text-[12px] font-medium transition-all"
                        style={
                          active
                            ? { background: 'rgba(74,144,217,0.12)', color: C.primary, border: '1px solid rgba(74,144,217,0.4)' }
                            : { background: C.bgSurfaceCont, color: C.text2, border: '1px solid transparent' }
                        }
                      >
                        <span>{c.name}（{c.icon}）</span>
                        <span>{count} 件</span>
                      </button>
                    );
                  })}
                </div>

                {pickCat && (
                  <div className="mt-3 border-t pt-2.5" style={{ borderColor: C.line }}>
                    <div className="text-[12px] font-semibold mb-1.5" style={{ color: C.text }}>
                      统一调整 · {pickCatName}（{catCountFor(pickCat)} 件）
                    </div>
                    {pickCat === 'bar' || pickCat === 'platform' ? (
                      <>
                        <div className="text-[11px] mb-1" style={{ color: C.text2 }}>统一着色</div>
                        <div className="flex flex-wrap gap-1.5">
                          {PART_COLORS.map((c) => (
                            <button
                              key={c.id}
                              title={c.name}
                              onClick={() => paintSelected(c.id)}
                              className="w-6 h-6 rounded-full cursor-pointer border"
                              style={{ background: c.hex, borderColor: C.line }}
                            />
                          ))}
                        </div>
                        {pickCat === 'bar' && (
                          <button
                            onClick={() => randomColorSelected()}
                            className="mt-2.5 w-full text-[12px] font-medium h-8 rounded-full transition-colors"
                            style={{ background: 'rgba(247,202,69,0.14)', color: '#B98A00', border: '1px solid #F0D98A' }}
                          >
                            随机上色
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-[11px] mb-1 leading-relaxed" style={{ color: C.text2 }}>
                          依据接线情况统一处理连接件：
                        </div>
                        <button
                          onClick={() => { replaceSelectedConnectors('connector-v6'); }}
                          className="mt-1.5 w-full text-[12px] font-medium h-8 rounded-full transition-colors"
                          style={{ background: 'rgba(74,144,217,0.1)', color: C.primary, border: '1px solid rgba(74,144,217,0.35)' }}
                        >
                          统一调成六向连接件
                        </button>
                        <button
                          onClick={() => { optimizeSelectedConnectors(); }}
                          className="mt-2 w-full text-[12px] font-medium h-8 rounded-full transition-colors"
                          style={{ background: 'rgba(38,194,129,0.12)', color: '#1A9F66', border: '1px solid rgba(38,194,129,0.4)' }}
                        >
                          自动精简空闲连接端
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            }
          >
            <Tooltip title="弹出分类菜单，选择杆件/连接件/平台板即可整类全选，并统一调整颜色或连接端">
              <button
                className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[13px] font-medium border transition-all"
                style={
                  selSameOpen
                    ? { background: 'rgba(74,144,217,0.12)', color: C.primary, borderColor: 'rgba(74,144,217,0.4)' }
                    : { background: '#fff', color: C.text2, borderColor: C.line }
                }
                onClick={handleSelectSame}
              >
                <SelectOutlined /> 全选同类
              </button>
            </Tooltip>
          </Popover>

          <Button
            className="flex items-center rounded-full text-[13px]"
            style={
              snapEnabled
                ? { background: 'rgba(38,194,129,0.12)', color: '#1A9F66', border: '1px solid rgba(38,194,129,0.4)' }
                : { background: '#fff', color: C.text2, borderColor: C.line }
            }
            icon={<ControlOutlined />}
            onClick={() => setSnapEnabled(!snapEnabled)}
          >
            吸附 {snapEnabled ? 'ON' : 'OFF'}
          </Button>
        </div>

        {/* 状态 / 导出 */}
        <div className="flex items-center gap-2">
          <span className="text-[12px]" style={{ color: C.text2 }}>
            已选中 <span className="font-semibold" style={{ color: C.text }}>{selectedCount}</span> 件
          </span>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            className="rounded-full text-[13px]"
            style={{ background: C.primary }}
            onClick={handleExport}
          >
            导出
          </Button>
        </div>
      </header>

      {/* 全选同类·点选模式提示横幅 */}
      {/* ===================== 主体 ===================== */}
      <div className="flex-1 flex min-h-0 relative">
        {/* 工作区：3D 场景 */}
        <div className="flex-1 relative min-w-0">
          <Scene3D />
          {/* 左上角快捷工作选项卡 */}
          <WorkflowTab
            workflow={workflow}
            gizmoMode={gizmoMode}
            setWorkflow={setWorkflow}
            setGizmoMode={setGizmoMode}
            generateFramework={generateFramework}
            layers={fwLayers}
            setLayers={setFwLayers}
            cols={fwCols}
            setCols={setFwCols}
            depth={fwDepth}
            setDepth={setFwDepth}
            setPaintColor={setPaintColor}
            setSelSameOpen={setSelSameOpen}
          />
        </div>

        {/* 右侧功能菜单面板 */}
        <RightPanel collapsed={panelCollapsed} onToggle={panelToggle} />
      </div>
    </div>
  );
}