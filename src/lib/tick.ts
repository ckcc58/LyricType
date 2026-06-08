/*
    1フレームごとに動作させたい関数を実行する
    歌詞表示に使う
    歌詞表示以外も使えるようにして、removeもしやすいような関数も入れておいた

    offとoffAllが多分効かない
        offするまでに次のidに更新されるから？

    25/01/31/ 19:20
        一旦callbackの返す値がfalseなら中止するコードで手を打った
*/

export class Tick {
    static on(callback: Function) {
        const repeat = () => {
            requestAnimationFrame(() => {
                let done = callback();
                if (done) {
                    repeat();
                }
            });
        }

        repeat();
    }
}