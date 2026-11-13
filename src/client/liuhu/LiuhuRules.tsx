// 常宁六胡抢规则说明。
import { Modal } from '../components/ui.tsx'
import { Zi } from './Zi.tsx'

export function LiuhuRulesBody() {
  const row = (kinds: number[]) => <span className="lh-rule-tiles">{kinds.map((kind, index) => <Zi key={index} kind={kind} className="s" />)}</span>
  return (
    <div className="rules">
      <section>
        <h3>一句话玩法</h3>
        <p>四个人打字牌，把牌凑成一门一门的「门子」，<b>胡数够 6 胡</b>就能胡。玩的是「抢」不是「大」——能胡就胡。</p>
      </section>
      <section>
        <h3>牌</h3>
        <ul>
          <li>共 80 张：小字一～十、大字壹～拾，各 4 张。</li>
          <li><b>二、七、十（贰、柒、拾）是红牌</b>，共 24 张，其余是黑牌：{row([1, 6, 9, 11, 16, 19])}</li>
        </ul>
      </section>
      <section>
        <h3>发牌与摸牌</h3>
        <ul>
          <li>首局翻牌比大小定庄，之后<b>谁胡谁做庄</b>；荒庄（牌摸完没人胡）庄家连庄。</li>
          <li>庄家 15 张，最后一张亮出来叫<b>挡底</b>；闲家 14 张。闲家正好缺挡底这张可以直接胡。</li>
          <li>庄家起手有四张一样的（提）当场亮出，然后打一张；闲家的提要等自己摸牌的回合才亮。</li>
          <li><b>摸的牌不入手</b>：摸出来先亮在桌上，要的人拿去组门子，没人要就放到摸牌人的右手边。手牌只减不增。</li>
        </ul>
      </section>
      <section>
        <h3>门子与胡数</h3>
        <table className="rules-table">
          <thead><tr><th>门子</th><th>怎么来</th><th>小字</th><th>大字</th></tr></thead>
          <tbody>
            <tr><td>碰</td><td>手里一对 + 别人打出 / 摸出的第三张</td><td>0</td><td>3</td></tr>
            <tr><td>坎</td><td>起手就有的三张</td><td>3</td><td>6</td></tr>
            <tr><td>笑</td><td>手里一对 + 自己摸到第三张</td><td>3</td><td>6</td></tr>
            <tr><td>跑</td><td>坎 / 碰 / 笑 + 别人的第四张</td><td>6</td><td>9</td></tr>
            <tr><td>提（龙）</td><td>坎 / 笑 + 自己摸到第四张，或起手四张</td><td>9</td><td>12</td></tr>
            <tr><td>二七十</td><td>{row([1, 6, 9])}</td><td>3</td><td>6</td></tr>
            <tr><td>一二三</td><td>{row([0, 1, 2])}</td><td>3</td><td>6</td></tr>
            <tr><td>其他顺子</td><td>{row([3, 4, 5])} 大小字不能混</td><td>0</td><td>0</td></tr>
            <tr><td>搭</td><td>{row([7, 7, 17])} 两张 + 另一种字的同点一张</td><td>0</td><td>0</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h3>胡牌</h3>
        <ul>
          <li>胡数 ≥ 6，并且所有的牌都凑成门子：<b>没有提 / 跑时是 5 门</b>；<b>有提 / 跑时是 4 门加一对将</b>（四张的也算一门）。</li>
          <li>单吊：只剩一张单牌时，只能等一模一样的那张来做将。</li>
          <li>起手的坎不能拆开用，也不能拆着打。</li>
        </ul>
      </section>
      <section>
        <h3>吃、碰与必须做的事</h3>
        <ul>
          <li>抢牌的先后固定是：<b>胡 &gt; 碰 &gt; 吃</b>，没有例外——哪怕是自己摸出来想吃的牌，别人要碰也是别人先碰。</li>
          <li><b>提、跑、笑是必须做的</b>：自己摸到就直接成，不参与抢牌，系统会自动完成。</li>
          <li>谁都可以碰；<b>只有下家能吃</b>别人打出的牌，自己摸出来的牌自己也能吃。</li>
          <li><b>下伙</b>：吃完之后手里还有同样的牌，必须把它也组成门子一起亮出来；亮不出来就不能吃。</li>
          <li>吃、碰、笑之后要打一张。<b>第一次提 / 跑打一张，第二次起叫重跑，不打</b>。</li>
          <li><b>臭牌</b>：想吃没吃、能碰没碰，这张牌之后就不能再吃 / 再碰了（还能笑、还能胡）。</li>
          <li><b>自己打过的牌不能再吃</b>：别人后来打出同样的、自己后来摸到同样的都不能吃，但可以胡。</li>
        </ul>
      </section>
      <section>
        <h3>算分</h3>
        <ul>
          <li>红黑倍数：<b>全黑</b>（0 张红）×5，<b>一点</b>（1 张红）×4，平胡（2～7 张）×1，<b>小红</b>（8～9 张）×2，<b>大红</b>（10 张以上）×4。</li>
          <li><b>自摸再 ×2</b>。每份 = 胡数 × 倍数（底分按 3 分计，免得出小数）。</li>
          <li><b>自摸</b>：三家各付一份。<b>放炮</b>：放炮的人一个人付三份。</li>
          <li>胡别人摸出来的牌、或者闲家胡挡底：三家各付一份，不翻倍。</li>
          <li>一张牌几家都能胡时，按顺序最近的一家胡。</li>
        </ul>
      </section>
    </div>
  )
}

export function LiuhuRules({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="六胡抢规则" onClose={onClose} width={860}>
      <LiuhuRulesBody />
    </Modal>
  )
}
