// 红中麻将规则说明。
import { Modal } from '../components/ui.tsx'
import { Tile } from './Tile.tsx'

export function MahjongRulesBody() {
  const row = (kinds: number[]) => <span className="mj-rule-tiles">{kinds.map((kind, index) => <Tile key={index} kind={kind} className="xxs" />)}</span>
  return (
    <div className="rules">
      <section>
        <h3>一句话玩法</h3>
        <p>四个人摸牌打牌，凑成「四组牌 + 一对将」就胡。<b>只能自摸</b>，别人打的牌不能胡；<b>红中是万能牌</b>。</p>
      </section>
      <section>
        <h3>牌与基本规则</h3>
        <ul>
          <li>共 112 张：万、条、筒各 36 张，加 4 张红中。没有东南西北和发、白。</li>
          <li><b>红中是癞子</b>，可以当任意一张牌用：{row([0, 1, 27])} 就算一组顺子。红中不能被碰、杠。</li>
          <li><b>不能吃</b>，可以碰、杠。</li>
          <li>胡牌牌型：四组（顺子或刻子）加一对将。对对胡可以胡，没有额外加分。</li>
          <li><b>只能自摸</b>：没有点炮，也没有抢杠胡。</li>
        </ul>
      </section>
      <section>
        <h3>定庄</h3>
        <ul>
          <li>第一局掷骰定庄：四人各掷一次两颗骰子，<b>点数合计最大的人坐庄</b>；并列最大的人再掷。</li>
          <li>之后<b>赢家坐庄</b>；流局（牌摸完没人胡）庄家连庄。</li>
        </ul>
      </section>
      <section>
        <h3>杠分（当场结算）</h3>
        <ul>
          <li><b>明杠（补杠）</b>：碰了之后自己摸到第 4 张 —— 三家各付 <b>1 分</b>。</li>
          <li><b>放杠</b>：别人打出一张、你手里正好有三张去杠 —— <b>放杠的人付 3 分</b>。</li>
          <li><b>暗杠</b>：自己摸齐 4 张 —— 三家各付 <b>2 分</b>。</li>
          <li>杠分当场结算，流局也不退。</li>
        </ul>
      </section>
      <section>
        <h3>胡牌与抓鸟</h3>
        <ul>
          <li>胡牌后翻 <b>1 只鸟</b>，三家各付这只鸟的分数。</li>
          <li>鸟不分万条筒，只看点数：<b>一点、九点、红中 = 10 分</b>；其余 = <b>点数 + 1</b>（二点 3 分 … 八点 9 分）。</li>
          <li><b>杀鬼</b>：胡牌时手里没有红中，<b>分数翻倍</b>。例如杀鬼抓到一万，就是每家 20 分。</li>
          <li>如果胡牌时牌墙已经摸完，就用胡的那张牌当鸟。</li>
        </ul>
      </section>
      <section>
        <h3>人机试炼与教练</h3>
        <ul>
          <li>四档难度：入门 / 进阶 / 高手 / 大师。因为只能自摸，这套规则不存在"防守"，比的就是<b>牌效</b>——谁进张多、成牌快。</li>
          <li>打开右上角的<b>教练提示</b>，轮到你出牌时每张牌上方会显示打掉它之后的<b>进张数</b>，「荐」是进张最多的打法。</li>
          <li><b>向听数</b>：还差几张有效牌才能听牌。0 向听就是已经听牌。</li>
          <li>每局结束可以<b>复盘</b>：逐手对比你的打法和最优打法；填了 DeepSeek API Key 还能让 AI 教练写点评。</li>
        </ul>
      </section>
      <section>
        <h3>操作</h3>
        <p>点一张牌选中，再点一次打出；也可以双击，或按住往上一甩。能碰、杠、胡时，手牌上方会出现大按钮。</p>
      </section>
    </div>
  )
}

export function MahjongRules({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="红中麻将规则" onClose={onClose} width={860}>
      <MahjongRulesBody />
    </Modal>
  )
}
