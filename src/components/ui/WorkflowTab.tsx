'use client';

import { Tooltip } from 'antd';
import {
  AppstoreOutlined,
  DragOutlined,
  BorderOutlined,
  ArrowsAltOutlined,
} from '@ant-design/icons';

const C = {
  primary: '#4A90D9',
  text: '#333333',
  text2: '#6B7280',
  line: '#E4E9EE',
  bgSurfaceCont: '#EFF3F6',
};

const STEPS = [
  {
    key: 'spec',
    name: '生成框架',
    icon: <AppstoreOutlined />,
    desc: '输入 层高/列深 自动生成基础框架',
  },
  {
    key: 'frame',
    name: '增加框架',
    icon: <DragOutlined />,
    desc: '调整/生长 杆件和连接件（生长模式）',
  },
  {
    key: 'accessory',
    name: '增加配件',
    icon: <BorderOutlined />,
    desc: '添加平台板封面、右键替换同类（生长模式）',
  },
  {
    key: 'move',
    name: '移动配件',
    icon: <ArrowsAltOutlined />,
    desc: '选中物件显示操作轴，可自由移动/旋转编辑',
  },
] as const;

type StepKey = 'spec' | 'frame' | 'accessory' | 'move';

interface Props {
  section?: 'modes' | 'parameters';
  workflow: 'spec' | 'frame' | 'accessory';
  gizmoMode: 'move' | 'growth';
  setWorkflow: (w: 'spec' | 'frame' | 'accessory') => void;
  setGizmoMode: (m: 'move' | 'growth') => void;
  generateFramework: (layers: number, cols: number, depth: number) => void;
  layers: number;
  setLayers: (n: number) => void;
  cols: number;
  setCols: (n: number) => void;
  depth: number;
  setDepth: (n: number) => void;
  setPaintColor: (c: string | null) => void;
  setSelSameOpen: (open: boolean) => void;
}

export default function WorkflowTab({
  section,
  workflow,
  gizmoMode,
  setWorkflow,
  setGizmoMode,
  generateFramework,
  layers,
  setLayers,
  cols,
  setCols,
  depth,
  setDepth,
  setPaintColor,
  setSelSameOpen,
}: Props) {
  const handleStepClick = (key: StepKey) => {
    setPaintColor(null);
    setSelSameOpen(false);
    if (key === 'spec') {
      setWorkflow('spec');
      setGizmoMode('growth');
    } else if (key === 'frame') {
      setWorkflow('frame');
      setGizmoMode('growth');
    } else if (key === 'accessory') {
      setWorkflow('accessory');
      setGizmoMode('growth');
    } else if (key === 'move') {
      setGizmoMode('move');
    }
  };

  const isActive = (key: StepKey) => {
    if (key === 'move') return gizmoMode === 'move';
    return workflow === key && gizmoMode === 'growth';
  };
  return (
    <div
      className={
        section === 'modes' ? 'designer-workflow' : 'designer-parameters'
      }
    >
      {/* 四个工作模式切换 */}
      {section !== 'parameters' && (
        <div
          className="designer-mode-switch"
          role="group"
          aria-label="搭建工作模式"
        >
          {STEPS.map((s) => {
            const active = isActive(s.key);
            return (
              <Tooltip key={s.key} title={s.desc}>
                <button
                  aria-pressed={active}
                  aria-label={s.name}
                  onClick={() => handleStepClick(s.key)}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-[12px] font-semibold transition-all"
                  style={
                    active
                      ? {
                          background: 'rgba(74,144,217,0.12)',
                          color: C.primary,
                          boxShadow: '0 2px 8px rgba(74,144,217,0.25)',
                        }
                      : { background: 'transparent', color: C.text2 }
                  }
                >
                  <span className="text-[14px]">{s.icon}</span>
                  {s.name}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}

      {/* 当前阶段操作区 */}
      {section !== 'modes' && (
        <div className="designer-parameter-body">
          <div className="designer-parameter-title">
            <strong>
              {workflow === 'spec' && gizmoMode !== 'move'
                ? '框架尺寸'
                : '搭建提示'}
            </strong>
            <span>
              {workflow === 'spec' && gizmoMode !== 'move' ? '每格 40 cm' : ''}
            </span>
          </div>
          {gizmoMode === 'move' ? (
            <div
              className="flex items-center gap-2 text-[11px] leading-relaxed"
              style={{ color: C.text2 }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: '#26C281' }}
              />
              选中物件显示操作轴，可自由
              <b style={{ color: C.text }}>移动/旋转</b>编辑；不显示扩展幽灵。
            </div>
          ) : workflow === 'spec' ? (
            <div className="designer-parameter-fields">
              <NumberField label="层数" value={layers} onChange={setLayers} />
              <NumberField label="列数" value={cols} onChange={setCols} />
              <NumberField label="纵深" value={depth} onChange={setDepth} />
              <button
                onClick={() => {
                  generateFramework(layers, cols, depth);
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() =>
                      window.dispatchEvent(
                        new CustomEvent('gizmo-reset-camera'),
                      ),
                    ),
                  );
                }}
                className="h-9 px-4 rounded-xl text-[12px] font-semibold text-white shrink-0 transition-all hover:opacity-90"
                style={{ background: '#FF9F43', color: '#283544' }}
              >
                生成框架
              </button>
            </div>
          ) : workflow === 'frame' ? (
            <div
              className="flex items-center gap-2 text-[11px] leading-relaxed"
              style={{ color: C.text2 }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: C.primary }}
              />
              此阶段仅支持编辑与生长{' '}
              <b style={{ color: C.text }}>杆件、连接件</b>；
              选中的杆件/连接件进入生长模式可链式延长框架。
            </div>
          ) : (
            <div
              className="flex items-center gap-2 text-[11px] leading-relaxed"
              style={{ color: C.text2 }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: '#FF9F43' }}
              />
              此阶段添加 <b style={{ color: C.text }}>平台板封面</b>
              （生长模式自动识别杆框架出 ghost），
              右键任意配件可更换为对应同类配件。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col">
      <span
        className="text-[10px] mb-0.5 font-medium"
        style={{ color: C.text2 }}
      >
        {label}
      </span>
      <input
        name={label}
        aria-label={label}
        type="number"
        min={1}
        max={20}
        value={value}
        onChange={(e) =>
          onChange(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))
        }
        className="w-14 h-9 rounded-lg border text-center text-[13px] font-semibold outline-none focus:ring-2 transition-all"
        style={{ borderColor: C.line, color: C.text, background: '#fff' }}
      />
    </label>
  );
}
