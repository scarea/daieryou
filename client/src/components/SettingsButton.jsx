import React from 'react'
import { Button, Popover, Segmented, Slider, Switch } from 'antd'
import { MutedOutlined, SettingOutlined, SoundOutlined } from '@ant-design/icons'
import useSettingsStore from '../settings/settingsStore'
import soundEngine from '../audio/soundEngine'

const QUALITY_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '省电' },
]

const VolumeRow = ({ label, value, onChange }) => (
  <div className="settings-row">
    <span>{label}</span>
    <Slider
      min={0}
      max={100}
      value={Math.round(value * 100)}
      onChange={(next) => onChange(next / 100)}
      tooltip={{ formatter: (next) => `${next}%` }}
    />
  </div>
)

const SettingsPanel = () => {
  const settings = useSettingsStore()
  const { update } = settings

  return (
    <div className="settings-panel">
      <VolumeRow label="音乐" value={settings.musicVolume} onChange={(musicVolume) => update({ musicVolume })} />
      <VolumeRow
        label="音效"
        value={settings.sfxVolume}
        onChange={(sfxVolume) => {
          update({ sfxVolume })
          soundEngine.chipClink()
        }}
      />
      <VolumeRow label="环境声" value={settings.ambienceVolume} onChange={(ambienceVolume) => update({ ambienceVolume })} />
      <div className="settings-row">
        <span>画质</span>
        <Segmented
          size="small"
          options={QUALITY_OPTIONS}
          value={settings.quality}
          onChange={(quality) => update({ quality })}
        />
      </div>
      <div className="settings-row">
        <span>减少动效</span>
        <Switch size="small" checked={settings.reducedMotion} onChange={(reducedMotion) => update({ reducedMotion })} />
      </div>
      <div className="settings-row">
        <span>触感震动</span>
        <Switch size="small" checked={settings.haptics} onChange={(haptics) => update({ haptics })} />
      </div>
    </div>
  )
}

// 全局设置入口：一个静音快捷键 + 一个设置面板
const SettingsButton = ({ className = '' }) => {
  const muted = useSettingsStore((state) => state.muted)
  const toggleMuted = useSettingsStore((state) => state.toggleMuted)

  return (
    <div className={`settings-dock ${className}`.trim()}>
      <Button
        type="text"
        shape="circle"
        icon={muted ? <MutedOutlined /> : <SoundOutlined />}
        onClick={toggleMuted}
        aria-label={muted ? '开启声音' : '静音'}
      />
      <Popover content={<SettingsPanel />} title="声音与画面" trigger="click" placement="topLeft">
        <Button type="text" shape="circle" icon={<SettingOutlined />} aria-label="设置" />
      </Popover>
    </div>
  )
}

export default SettingsButton
