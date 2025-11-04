import SwiftUI

struct PulsingMarkerView: View {
    // アニメーションの状態を管理する変数
    @State private var animate = false

    var body: some View {
        ZStack {
            // --- 波動（外側） ---
            Circle()
                .stroke(Color.blue.opacity(0.8), lineWidth: 2)
                .frame(width: 40, height: 40) // マーカーより大きく
                .scaleEffect(animate ? 1.0 : 0.0) // 0から1に拡大
                .opacity(animate ? 0.0 : 1.0)     // 1から0にフェードアウト
                .animation(
                    Animation.easeOut(duration: 1.5).repeatForever(autoreverses: false),
                    value: animate
                )

            // --- 波動（内側・少し遅れて開始） ---
            Circle()
                .stroke(Color.blue.opacity(0.8), lineWidth: 2)
                .frame(width: 40, height: 40)
                .scaleEffect(animate ? 1.0 : 0.0)
                .opacity(animate ? 0.0 : 1.0)
                .animation(
                    Animation.easeOut(duration: 1.5).repeatForever(autoreverses: false).delay(0.75), // 0.75秒遅れ
                    value: animate
                )
            
            // --- 中心の矢印マーカー ---
            // （SF Symbolsの "location.north.fill" を例として使用しています）
            Image(systemName: "location.north.fill")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 20, height: 20) // 矢印のサイズ
                .foregroundColor(.blue)
                .padding(6) // 矢印の周りの余白
                .background(Color.white)
                .clipShape(Circle()) // 背景を円形に
                .shadow(radius: 3) // 影
            // ------------------------
        }
        .onAppear {
            // Viewが表示されたらアニメーションを開始
            self.animate = true
        }
    }
}

// プレビュー用のコード（なくても動作に影響しません）
struct PulsingMarkerView_Previews: PreviewProvider {
    static var previews: some View {
        PulsingMarkerView()
            .previewLayout(.sizeThatFits)
            .padding(40)
    }
}
