plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    systemProperty("tw.projectDir", projectDir.absolutePath)
}

dependencies {
    api(project(":core-model"))
    testImplementation(libs.kotlin.test)
}
