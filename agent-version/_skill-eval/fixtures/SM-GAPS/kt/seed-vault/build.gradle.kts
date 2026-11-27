plugins {
    id("org.springframework.boot") version "3.3.4"
    id("io.spring.dependency-management") version "1.1.6"
    kotlin("jvm") version "1.9.25"
    kotlin("plugin.spring") version "1.9.25"
    kotlin("plugin.jpa") version "1.9.25"
    id("org.openapi.generator") version "7.8.0"
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    runtimeOnly("org.postgresql:postgresql")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

// Контракт живёт в репе contracts: интерфейсы контроллеров генерируются при сборке, в исходниках их нет.
openApiGenerate {
    generatorName.set("kotlin-spring")
    remoteInputSpec.set("https://contracts.internal.example/seed-vault/openapi.yaml")
    apiPackage.set("org.seedvault.api")
    modelPackage.set("org.seedvault.api.model")
    configOptions.set(mapOf("interfaceOnly" to "true", "useSpringBoot3" to "true", "useTags" to "true"))
}

sourceSets["main"].kotlin.srcDir(layout.buildDirectory.dir("generate-resources/main/src/main/kotlin"))
tasks.compileKotlin { dependsOn(tasks.openApiGenerate) }
