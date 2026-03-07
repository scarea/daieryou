import React from 'react'
import { Modal, Typography, Divider, Space, Tag } from 'antd'
import { TrophyOutlined, FireOutlined, QuestionCircleOutlined } from '@ant-design/icons'

const { Title, Text, Paragraph } = Typography

const GameRules = ({ visible, onClose }) => {
  return (
    <Modal
      title={
        <Space>
          <QuestionCircleOutlined />
          <span>游戏规则</span>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={720}
      className="game-rules-modal"
    >
      <div className="game-rules-content">
        <Title level={4}>基本规则</Title>
        <Paragraph>
          <ul>
            <li><strong>3名玩家</strong>一个房间</li>
            <li>使用 <strong>54张牌</strong>（A-K + 大小王）</li>
            <li><strong>大小王作为赖子</strong>：自动按当前三张组合推导为"最大牌型"</li>
            <li>每轮比大小，<Tag color="orange">第二名为输家</Tag></li>
            <li>共进行 <strong>5轮</strong>游戏</li>
          </ul>
        </Paragraph>

        <Divider />

        <Title level={4}>游戏流程</Title>
        <Paragraph>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text><strong>第1轮：</strong>每人发5张起始牌，配合第1张公牌选择2张；出牌进入"出牌区"，不会回到手牌</Text>
            <Text><strong>第2-3轮：</strong>每轮结算后，按"本轮输家先摸"顺序每人摸2张，手牌回到5张，再继续选牌</Text>
            <Text><strong>第4轮：</strong><Tag color="purple">暗牌公牌回合</Tag>（牌面隐藏），仍需选择2张；本轮后不再摸牌</Text>
            <Text><strong>第5轮：</strong>无公牌，直接用每人剩余3张手牌比大小并结算最终积分</Text>
          </Space>
        </Paragraph>

        <Divider />

        <Title level={4}>牌型大小（从大到小）</Title>
        <Paragraph>
          <ol>
            <li><Tag color="red">豹子</Tag> - 三张相同点数（如：AAA、KKK）</li>
            <li><Tag color="volcano">同花顺</Tag> - 同花色顺子（如：♠️567）</li>
            <li><Tag color="orange">同花</Tag> - 三张同花色（如：♥️AK4）</li>
            <li><Tag color="gold">顺子</Tag> - 三张连续点数（如：789）</li>
            <li><Tag color="green">对子</Tag> - 两张相同点数（如：AA4）</li>
            <li><Tag color="blue">高牌</Tag> - 不符合以上任何牌型</li>
          </ol>
          <Text type="secondary">注：A可作为最大牌（AKQ）或最小牌（A23）</Text>
        </Paragraph>

        <Divider />

        <Title level={4}>积分规则</Title>
        <Paragraph>
          <ul>
            <li>各轮积分：<Tag>1分</Tag> <Tag>2分</Tag> <Tag>3分</Tag> <Tag>4分</Tag> <Tag>5分</Tag></li>
            <li><Tag color="orange">次名为输家</Tag>：需要分别向 <Tag color="green">头名</Tag> 与 <Tag color="red">末位</Tag> 各结算一笔积分</li>
            <li>常规单笔结算分值为当轮基础分</li>
            <li><strong>豹子双倍：</strong>若输家和某一位赢家都为豹子，该笔结算翻倍</li>
            <li>输家本轮总扣分 = 对两位赢家两笔结算之和</li>
          </ul>
        </Paragraph>

        <Paragraph>
          <Text strong>示例（当轮基础分 = 1）：</Text>
          <br />
          <Text>牌型：<Tag color="green">QQQ（头名）</Tag> <Tag color="orange">888（次名）</Tag> <Tag color="red">AJ4（末位）</Tag></Text>
          <br />
          <Text>结算：次名输给头名 <strong>2分</strong>（豹子对豹子翻倍），次名输给末位 <strong>1分</strong>（常规）</Text>
          <br />
          <Text>结果：头名 +2，次名 -3，末位 +1</Text>
        </Paragraph>

        <Divider />

        <Title level={4}>特殊机制</Title>
        <Paragraph>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Text><strong>暗牌回合：</strong>第4轮的公牌不会显示，但仍需选择2张手牌与之组合</Text>
            <Text><strong>托管机制：</strong>超时未选牌时，系统会自动随机选择2张手牌</Text>
            <Text><strong>并列名次：</strong>如果多人牌型相同，则并列同一名次，积分结算规则相应调整</Text>
          </Space>
        </Paragraph>
      </div>
    </Modal>
  )
}

export default GameRules

