import { Text, View } from "react-native";

// Phase 0 placeholder screen: a title and one message. No behaviour, no animation, no env reads.
export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-placeholder-bg dark:bg-placeholder-bg-dark px-6">
      <Text
        accessibilityRole="header"
        className="text-[28px] font-bold text-placeholder-title dark:text-placeholder-title-dark"
      >
        Xelulu
      </Text>
      <Text className="mt-3 text-[18px] text-placeholder-body dark:text-placeholder-body-dark">
        Phase 0 placeholder
      </Text>
    </View>
  );
}
